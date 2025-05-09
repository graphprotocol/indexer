import {
  Address,
  formatGRT,
  Logger,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  AllocationManager,
  getEscrowSenderForSigner,
  GraphNode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  QueryFeeModels,
  sequentialTimerMap,
  SubgraphClient,
  SubgraphIdentifierType,
  TapCollector,
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
import { Wallet } from 'ethers'

const DIPS_COLLECTION_INTERVAL = 60_000

const uuidToHex = (uuid: string) => {
  return `0x${uuid.replace(/-/g, '')}`
}

const normalizeAddressForDB = (address: string) => {
  return toAddress(address).toLowerCase().replace('0x', '')
}

type GetEscrowSenderForSigner = (
  tapSubgraph: SubgraphClient,
  signer: Address,
) => Promise<Address>
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
        const cancellation =
          await this.gatewayDipsServiceMessagesCodec.createSignedCancellationRequest(
            uuidToHex(agreement.id),
            this.network.wallet,
          )
        await this.gatewayDipsServiceClient.CancelAgreement({
          version: 1,
          signedCancellation: cancellation,
        })

        // Mark the agreement as cancelled
        agreement.cancelled_at = new Date()
        agreement.updated_at = new Date()
        await agreement.save()
      } catch (error) {
        this.logger.error(`Error cancelling agreement ${agreement.id}`, { error })
      }
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
      `Ensuring indexing rules for ${indexingAgreements.length} agreement${
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
      if (!ruleExists) {
        this.logger.info(
          `Creating indexing rule for agreement ${agreement.id}, deployment ${agreement.subgraph_deployment_id}`,
        )
        const indexingRule = {
          identifier: agreement.subgraph_deployment_id,
          allocationAmount: formatGRT(
            this.network.specification.indexerOptions.dipsAllocationAmount,
          ),
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
          protocolNetwork: this.network.specification.networkIdentifier,
          autoRenewal: true,
          allocationLifetime: Math.max(
            Number(agreement.min_epochs_per_collection),
            Number(agreement.max_epochs_per_collection) -
              this.network.specification.indexerOptions.dipsEpochsMargin,
          ),
        } as Partial<IndexingRuleAttributes>

        await upsertIndexingRule(this.logger, this.models, indexingRule)
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
}

export class DipsCollector {
  declare gatewayDipsServiceClient: GatewayDipsServiceClientImpl
  declare gatewayDipsServiceMessagesCodec: GatewayDipsServiceMessagesCodec
  constructor(
    private logger: Logger,
    private managementModels: IndexerManagementModels,
    private queryFeeModels: QueryFeeModels,
    private specification: NetworkSpecification,
    private tapCollector: TapCollector,
    private wallet: Wallet,
    private graphNode: GraphNode,
    public escrowSenderGetter: GetEscrowSenderForSigner,
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
    queryFeeModels: QueryFeeModels,
    specification: NetworkSpecification,
    tapCollector: TapCollector,
    wallet: Wallet,
    graphNode: GraphNode,
    escrowSenderGetter?: GetEscrowSenderForSigner,
  ) {
    const collector = new DipsCollector(
      logger,
      managementModels,
      queryFeeModels,
      specification,
      tapCollector,
      wallet,
      graphNode,
      escrowSenderGetter ?? getEscrowSenderForSigner,
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
        if (!this.tapCollector) {
          throw new Error('TapCollector not initialized')
        }
        // Store the tap receipt in the database
        this.logger.info('Decoding TAP receipt for agreement')
        const tapReceipt = this.gatewayDipsServiceMessagesCodec.decodeTapReceipt(
          response.tapReceipt,
          this.tapCollector?.tapContracts.tapVerifier.address,
        )
        // Check that the signer of the TAP receipt is a signer
        // on the corresponding escrow account for the payer (sender) of the
        // indexing agreement
        const escrowSender = await this.escrowSenderGetter(
          this.tapCollector?.tapSubgraph,
          tapReceipt.signer_address,
        )
        if (escrowSender !== toAddress(agreement.payer)) {
          // TODO: should we cancel the agreement here?
          throw new Error(
            'Signer of TAP receipt is not a signer on the indexing agreement',
          )
        }
        if (tapReceipt.allocation_id !== toAddress(agreement.last_allocation_id)) {
          throw new Error('Allocation ID mismatch')
        }
        await this.queryFeeModels.scalarTapReceipts.create(tapReceipt)
        // Mark the agreement as having had a payment collected
        agreement.last_payment_collected_at = new Date()
        agreement.updated_at = new Date()
        await agreement.save()
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
