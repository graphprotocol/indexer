import {
  Address,
  formatGRT,
  Logger,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  ActionStatus,
  Allocation,
  AllocationManager,
  DipsReceiptStatus,
  GraphNode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  sequentialTimerMap,
  SubgraphIdentifierType,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'
import { Op } from 'sequelize'

import {
  createGatewayDipsServiceClient,
  GatewayDipsServiceMessagesCodec,
} from './gateway-dips-service-client'
import {
  CollectPaymentStatus,
  GatewayDipsServiceClientImpl,
} from '@graphprotocol/dips-proto/generated/gateway'
import { IndexingAgreement } from '../indexer-management/models/indexing-agreement'
import { NetworkSpecification } from '../network-specification'
import { BaseWallet } from 'ethers'

const DIPS_COLLECTION_INTERVAL = 60_000

const uuidToHex = (uuid: string) => {
  return `0x${uuid.replace(/-/g, '')}`
}

const normalizeAddressForDB = (address: string) => {
  return toAddress(address).toLowerCase().replace('0x', '')
}

export class DipsManager {
  declare gatewayDipsServiceClient: GatewayDipsServiceClientImpl
  declare gatewayDipsServiceMessagesCodec: GatewayDipsServiceMessagesCodec
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private network: Network,
    private parent: AllocationManager | null,
  ) {
    if (!this.network.specification.indexerOptions.dipperEndpoint) {
      throw new Error('dipperEndpoint is not set')
    }
    this.gatewayDipsServiceClient = createGatewayDipsServiceClient(
      this.network.specification.indexerOptions.dipperEndpoint,
    )
    this.gatewayDipsServiceMessagesCodec = new GatewayDipsServiceMessagesCodec()
  }
  // Cancel an agreement associated to an allocation if it exists
  async tryCancelAgreement(allocationId: string) {
    const normalizedAllocationId = normalizeAddressForDB(allocationId)
    const agreement = await this.models.IndexingAgreement.findOne({
      where: {
        current_allocation_id: normalizedAllocationId,
        cancelled_at: null,
      },
    })
    if (agreement) {
      try {
        await this._tryCancelAgreement(agreement)
      } catch (error) {
        this.logger.error(`Error cancelling agreement ${agreement.id}`, { error })
      }
    }
  }
  async _tryCancelAgreement(agreement: IndexingAgreement) {
    try {
      const cancellation =
        await this.gatewayDipsServiceMessagesCodec.createSignedCancellationRequest(
          uuidToHex(agreement.id),
          this.network.wallet,
        )
      await this.gatewayDipsServiceClient.CancelAgreement({
        version: 1,
        signedCancellation: cancellation,
      })
      agreement.cancelled_at = new Date()
      agreement.updated_at = new Date()
      await agreement.save()
    } catch (error) {
      this.logger.error(`Error cancelling agreement ${agreement.id}`, { error })
    }
  }
  // Update the current and last allocation ids for an agreement if it exists
  async tryUpdateAgreementAllocation(
    deploymentId: string,
    oldAllocationId: Address | null,
    newAllocationId: Address | null,
  ) {
    const agreement = await this.models.IndexingAgreement.findOne({
      where: {
        subgraph_deployment_id: deploymentId,
      },
    })
    if (agreement) {
      agreement.current_allocation_id = newAllocationId
      agreement.last_allocation_id = oldAllocationId
      agreement.last_payment_collected_at = null
      agreement.updated_at = new Date()
      await agreement.save()
    }
  }
  async ensureAgreementRules() {
    if (!this.parent) {
      this.logger.error(
        'DipsManager has no parent AllocationManager, cannot ensure agreement rules',
      )
      return
    }
    // Get all the indexing agreements that are not cancelled
    const indexingAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: null,
      },
    })
    this.logger.debug(
      `Ensuring indexing rules for ${indexingAgreements.length} active agreement${
        indexingAgreements.length === 1 ? '' : 's'
      }`,
    )
    // For each agreement, check that there is an indexing rule to always
    // allocate to the agreement's subgraphDeploymentId, and if not, create one
    for (const agreement of indexingAgreements) {
      const subgraphDeploymentID = new SubgraphDeploymentID(
        agreement.subgraph_deployment_id,
      )
      this.logger.info(
        `Checking if indexing rule exists for agreement ${
          agreement.id
        }, deployment ${subgraphDeploymentID.toString()}`,
      )
      // If there is not yet an indexingRule that deems this deployment worth allocating to, make one
      const ruleExists = await this.parent.matchingRuleExists(
        this.logger,
        subgraphDeploymentID,
      )
      // Check if there is an indexing rule saying we should NEVER allocate to this one, consider it blocklisted
      const allDeploymentRules = await this.models.IndexingRule.findAll({
        where: {
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
        },
      })
      const blocklistedRule = allDeploymentRules.find(
        (rule) =>
          new SubgraphDeploymentID(rule.identifier).bytes32 ===
            subgraphDeploymentID.bytes32 &&
          rule.decisionBasis === IndexingDecisionBasis.NEVER,
      )
      if (blocklistedRule) {
        this.logger.info(
          `Blocklisted deployment ${subgraphDeploymentID.toString()}, skipping indexing rule creation`,
        )
        await this._tryCancelAgreement(agreement)
      } else if (!ruleExists) {
        this.logger.info(
          `Creating indexing rule for agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}`,
        )
        const indexingRule = {
          identifier: agreement.subgraph_deployment_id,
          allocationAmount: formatGRT(
            this.network.specification.indexerOptions.dipsAllocationAmount,
          ),
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
          protocolNetwork: this.network.specification.networkIdentifier,
          autoRenewal: true,
          allocationLifetime: Math.max(
            Number(agreement.min_epochs_per_collection),
            Number(agreement.max_epochs_per_collection) -
              this.network.specification.indexerOptions.dipsEpochsMargin,
          ),
          requireSupported: false,
        } as Partial<IndexingRuleAttributes>

        await upsertIndexingRule(this.logger, this.models, indexingRule)
      }
    }

    const cancelledAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: {
          [Op.ne]: null,
        },
      },
    })
    this.logger.debug(
      `Ensuring no DIPs indexing rules for ${
        cancelledAgreements.length
      } cancelled agreement${cancelledAgreements.length === 1 ? '' : 's'}`,
    )
    for (const agreement of cancelledAgreements) {
      this.logger.info(
        `Checking if indexing rule exists for cancelled agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}`,
      )
      // First check if there is another agreement that is not cancelled that has the same deployment id
      const otherAgreement = indexingAgreements.find(
        (a) =>
          a.subgraph_deployment_id === agreement.subgraph_deployment_id &&
          a.id !== agreement.id,
      )
      if (otherAgreement) {
        this.logger.info(
          `Another agreement ${otherAgreement.id} exists for deployment ${agreement.subgraph_deployment_id}, skipping removal of DIPs indexing rule`,
        )
        continue
      }
      const rule = await this.models.IndexingRule.findOne({
        where: {
          identifier: agreement.subgraph_deployment_id,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      if (rule) {
        this.logger.info(
          `Removing DIPs indexing rule for cancelled agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}`,
        )
        await this.models.IndexingRule.destroy({
          where: { id: rule.id },
        })
      }
    }
  }
  async getActiveDipsDeployments(): Promise<SubgraphDeploymentID[]> {
    // Get all the indexing agreements that are not cancelled
    const indexingAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: null,
      },
    })
    return indexingAgreements.map(
      (agreement) => new SubgraphDeploymentID(agreement.subgraph_deployment_id),
    )
  }
  async matchAgreementAllocations(allocations: Allocation[]) {
    const indexingAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: null,
      },
    })
    for (const agreement of indexingAgreements) {
      this.logger.trace(`Matching active agreement ${agreement.id}`)
      const allocation = allocations.find(
        (allocation) =>
          allocation.subgraphDeployment.id.bytes32 ===
          new SubgraphDeploymentID(agreement.subgraph_deployment_id).bytes32,
      )
      const actions = await this.models.Action.findAll({
        where: {
          deploymentID: agreement.subgraph_deployment_id,
          status: {
            [Op.or]: [
              ActionStatus.PENDING,
              ActionStatus.QUEUED,
              ActionStatus.APPROVED,
              ActionStatus.DEPLOYING,
            ],
          },
        },
      })
      this.logger.trace(`Found ${actions.length} actions for agreement ${agreement.id}`)
      if (allocation && actions.length === 0) {
        const currentAllocationId =
          agreement.current_allocation_id != null
            ? toAddress(agreement.current_allocation_id)
            : null
        this.logger.trace(
          `Current allocation id for agreement ${agreement.id} is ${currentAllocationId}`,
          {
            currentAllocationId,
            allocation,
          },
        )
        if (currentAllocationId !== allocation.id) {
          this.logger.warn(
            `Found mismatched allocation for agreement ${agreement.id}, updating from ${currentAllocationId} to ${allocation.id}`,
          )
          await this.tryUpdateAgreementAllocation(
            agreement.subgraph_deployment_id,
            currentAllocationId,
            allocation.id,
          )
        }
      }
    }
    // Now we find the cancelled agreements and check if their allocation is still active
    const cancelledAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: {
          [Op.ne]: null,
        },
        current_allocation_id: {
          [Op.ne]: null,
        },
      },
    })
    for (const agreement of cancelledAgreements) {
      this.logger.trace(`Matching cancelled agreement ${agreement.id}`)
      const allocation = allocations.find(
        (allocation) =>
          allocation.subgraphDeployment.id.bytes32 ===
          new SubgraphDeploymentID(agreement.subgraph_deployment_id).bytes32,
      )
      if (allocation == null && agreement.current_allocation_id != null) {
        const actions = await this.models.Action.findAll({
          where: {
            deploymentID: agreement.subgraph_deployment_id,
            status: {
              [Op.or]: [
                ActionStatus.PENDING,
                ActionStatus.QUEUED,
                ActionStatus.APPROVED,
                ActionStatus.DEPLOYING,
              ],
            },
          },
        })
        if (actions.length > 0) {
          this.logger.warn(
            `Found active actions for cancelled agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}, skipping matching allocation`,
          )
          continue
        }
        this.logger.info(
          `Updating last allocation id for cancelled agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}`,
        )
        await this.tryUpdateAgreementAllocation(
          agreement.subgraph_deployment_id,
          toAddress(agreement.current_allocation_id),
          null,
        )
      }
    }
  }
}

export class DipsCollector {
  declare gatewayDipsServiceClient: GatewayDipsServiceClientImpl
  declare gatewayDipsServiceMessagesCodec: GatewayDipsServiceMessagesCodec
  constructor(
    private logger: Logger,
    private managementModels: IndexerManagementModels,
    private specification: NetworkSpecification,
    private wallet: BaseWallet,
    private graphNode: GraphNode,
  ) {
    if (!this.specification.indexerOptions.dipperEndpoint) {
      throw new Error('dipperEndpoint is not set')
    }
    this.gatewayDipsServiceClient = createGatewayDipsServiceClient(
      this.specification.indexerOptions.dipperEndpoint,
    )
    this.gatewayDipsServiceMessagesCodec = new GatewayDipsServiceMessagesCodec()
  }

  static create(
    logger: Logger,
    managementModels: IndexerManagementModels,
    specification: NetworkSpecification,
    wallet: BaseWallet,
    graphNode: GraphNode,
  ) {
    const collector = new DipsCollector(
      logger,
      managementModels,
      specification,
      wallet,
      graphNode,
    )
    collector.startCollectionLoop()
    return collector
  }

  startCollectionLoop() {
    sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: DIPS_COLLECTION_INTERVAL,
      },
      async () => {
        this.logger.debug('Running DIPs payment collection loop')
        await this.collectAllPayments()
      },
      {
        onError: (err) => {
          this.logger.error('Failed to collect DIPs payments', { err })
        },
      },
    )
  }

  // Collect payments for all outstanding agreements
  async collectAllPayments() {
    // Part 1: Collect new payments
    const outstandingAgreements = await this.managementModels.IndexingAgreement.findAll({
      where: {
        last_payment_collected_at: null,
        last_allocation_id: {
          [Op.ne]: null,
        },
      },
    })
    for (const agreement of outstandingAgreements) {
      await this.tryCollectPayment(agreement)
    }

    // Part 2: Poll pending receipts
    await this.pollPendingReceipts()
  }

  async pollPendingReceipts() {
    // Find all pending receipts
    const pendingReceipts = await this.managementModels.DipsReceipt.findAll({
      where: {
        status: 'PENDING',
      },
    })

    if (pendingReceipts.length === 0) {
      return
    }

    this.logger.info(`Polling ${pendingReceipts.length} pending receipts`)

    for (const receipt of pendingReceipts) {
      try {
        const statusResponse = await this.gatewayDipsServiceClient.GetReceiptById({
          version: 1,
          receiptId: receipt.id,
        })

        if (statusResponse.status !== receipt.status) {
          const oldStatus = receipt.status
          receipt.status = statusResponse.status as DipsReceiptStatus
          receipt.transaction_hash = statusResponse.transactionHash || null
          receipt.error_message = statusResponse.errorMessage || null
          await receipt.save()

          this.logger.info(
            `Receipt ${receipt.id} status updated from ${oldStatus} to ${statusResponse.status}`,
            {
              receiptId: receipt.id,
              oldStatus: oldStatus,
              newStatus: statusResponse.status,
              transactionHash: statusResponse.transactionHash,
            },
          )
        }
      } catch (error) {
        this.logger.error(`Error polling receipt ${receipt.id}`, { error })
      }
    }
  }
  async tryCollectPayment(agreement: IndexingAgreement) {
    if (!agreement.last_allocation_id) {
      this.logger.error(`Agreement ${agreement.id} has no last allocation id`)
      return
    }
    const entityCounts = await this.graphNode.entityCount([
      new SubgraphDeploymentID(agreement.subgraph_deployment_id),
    ])
    if (entityCounts.length === 0) {
      this.logger.error(`Agreement ${agreement.id} has no entity count`)
      return
    }
    const entityCount = entityCounts[0]
    const collection =
      await this.gatewayDipsServiceMessagesCodec.createSignedCollectionRequest(
        uuidToHex(agreement.id),
        agreement.last_allocation_id,
        entityCount,
        this.wallet,
      )
    try {
      this.logger.info(`Collecting payment for agreement ${agreement.id}`)
      const response = await this.gatewayDipsServiceClient.CollectPayment({
        version: 1,
        signedCollection: collection,
      })
      if (response.status === CollectPaymentStatus.ACCEPT) {
        const receiptId = response.receiptId
        const amount = response.amount

        // Store the receipt ID in the database
        this.logger.info(`Received receipt ID ${receiptId} for agreement ${agreement.id}`)

        // Create DipsReceipt record with PENDING status
        await this.managementModels.DipsReceipt.create({
          id: receiptId,
          agreement_id: agreement.id,
          amount: amount,
          status: 'PENDING',
          retry_count: 0,
        })

        // Mark the agreement as having had a payment collected
        agreement.last_payment_collected_at = new Date()
        agreement.updated_at = new Date()
        await agreement.save()

        this.logger.info(
          `Payment collection initiated for agreement ${agreement.id}, receipt ID: ${receiptId}`,
        )
      } else {
        throw new Error(`Payment request not accepted: ${response.status}`)
      }
    } catch (error) {
      this.logger.error(`Error collecting payment for agreement ${agreement.id}`, {
        error,
      })
    }
  }
}
