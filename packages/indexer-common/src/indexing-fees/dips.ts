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
  AllocationStatus,
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
import { PendingRcaProposal } from '../indexer-management/models/pending-rca-proposal'
import { PendingRcaConsumer } from './pending-rca-consumer'
import { DecodedRcaProposal } from './types'
import { tryParseCustomError } from '../utils'
import { uniqueAllocationID, horizonAllocationIdProof } from '../allocations/keys'
import { encodeStartServiceData, PaymentTypes } from '@graphprotocol/toolshed'
import { NetworkSpecification } from '../network-specification'
import { AbiCoder, BaseWallet, MaxUint256, Signer } from 'ethers'
import {
  fetchCollectableAgreements,
  SubgraphIndexingAgreement,
} from './agreement-monitor'
import { CollectionTracker } from './collection-tracker'

const DIPS_COLLECTION_INTERVAL = 60_000
const DIPS_ACCEPTANCE_INTERVAL = 5_000

const uuidToHex = (uuid: string) => {
  return `0x${uuid.replace(/-/g, '')}`
}

const normalizeAddressForDB = (address: string) => {
  return toAddress(address).toLowerCase().replace('0x', '')
}

export class DipsManager {
  declare gatewayDipsServiceClient: GatewayDipsServiceClientImpl
  declare gatewayDipsServiceMessagesCodec: GatewayDipsServiceMessagesCodec
  declare pendingRcaConsumer: PendingRcaConsumer | null
  declare collectionTracker: CollectionTracker
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private network: Network,
    private graphNode: GraphNode,
    private parent: AllocationManager | null,
    pendingRcaModel?: typeof PendingRcaProposal,
  ) {
    // gRPC client — still needed for tryCancelAgreement() and DipsCollector
    if (this.network.specification.indexerOptions.dipperEndpoint) {
      this.gatewayDipsServiceClient = createGatewayDipsServiceClient(
        this.network.specification.indexerOptions.dipperEndpoint,
      )
      this.gatewayDipsServiceMessagesCodec = new GatewayDipsServiceMessagesCodec()
    }

    // Pending RCA consumer — new data source for ensureAgreementRules()
    if (pendingRcaModel) {
      this.pendingRcaConsumer = new PendingRcaConsumer(this.logger, pendingRcaModel)
    } else {
      this.pendingRcaConsumer = null
    }

    this.collectionTracker = new CollectionTracker(
      this.network.specification.indexerOptions.dipsCollectionTarget,
    )
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

    // Use PendingRcaConsumer if available, otherwise fall back to old IndexingAgreement model
    if (this.pendingRcaConsumer) {
      await this.ensureAgreementRulesFromRca()
    } else {
      await this.ensureAgreementRulesFromLegacy()
    }
  }

  private async getDipsAllocationAmount(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<{ amount: bigint; isDenied: boolean }> {
    const isDenied = await this.network.contracts.RewardsManager.isDenied(
      subgraphDeploymentId.bytes32,
    )

    if (isDenied) {
      return {
        amount: BigInt(this.network.specification.indexerOptions.dipsAllocationAmount),
        isDenied,
      }
    }

    // Rewarded subgraph: use rule's allocationAmount or defaultAllocationAmount
    const rule = await this.models.IndexingRule.findOne({
      where: {
        identifier: subgraphDeploymentId.ipfsHash,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
      },
    })

    if (rule?.allocationAmount) {
      return { amount: BigInt(rule.allocationAmount), isDenied }
    }

    return {
      amount: BigInt(this.network.specification.indexerOptions.defaultAllocationAmount),
      isDenied,
    }
  }

  private async ensureAgreementRulesFromRca() {
    const proposals = await this.pendingRcaConsumer!.getPendingProposals()
    this.logger.debug(
      `Ensuring indexing rules for ${proposals.length} pending RCA proposal${
        proposals.length === 1 ? '' : 's'
      }`,
    )

    for (const proposal of proposals) {
      const subgraphDeploymentID = proposal.subgraphDeploymentId
      this.logger.info(
        `Checking if indexing rule exists for proposal ${
          proposal.id
        }, deployment ${subgraphDeploymentID.toString()}`,
      )

      const ruleExists = await this.parent!.matchingRuleExists(
        this.logger,
        subgraphDeploymentID,
      )

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
          `Blocklisted deployment ${subgraphDeploymentID.toString()}, rejecting proposal`,
        )
        await this.pendingRcaConsumer!.markRejected(proposal.id, 'deployment blocklisted')
      } else if (!ruleExists) {
        this.logger.info(
          `Creating indexing rule for proposal ${
            proposal.id
          }, deployment ${subgraphDeploymentID.toString()}`,
        )
        const { amount } = await this.getDipsAllocationAmount(subgraphDeploymentID)
        const indexingRule = {
          identifier: subgraphDeploymentID.ipfsHash,
          allocationAmount: formatGRT(amount),
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
          protocolNetwork: this.network.specification.networkIdentifier,
          autoRenewal: true,
          allocationLifetime: Math.max(
            Number(proposal.minSecondsPerCollection),
            Number(proposal.maxSecondsPerCollection),
          ),
          requireSupported: false,
        } as Partial<IndexingRuleAttributes>

        await upsertIndexingRule(this.logger, this.models, indexingRule)
      }
    }
  }

  async acceptPendingProposals(activeAllocations: Allocation[]): Promise<void> {
    if (!this.pendingRcaConsumer) {
      return
    }
    const consumer = this.pendingRcaConsumer

    const proposals = await consumer.getPendingProposals()
    if (proposals.length === 0) {
      return
    }

    this.logger.info('Processing pending RCA proposals for on-chain acceptance', {
      count: proposals.length,
    })

    for (const proposal of proposals) {
      try {
        await this.processProposal(consumer, proposal, activeAllocations)
      } catch (error) {
        this.logger.error('Unexpected error processing proposal', {
          proposalId: proposal.id,
          error,
        })
      }
    }
  }

  private async processProposal(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    activeAllocations: Allocation[],
  ): Promise<void> {
    const now = BigInt(Math.floor(Date.now() / 1000))

    if (proposal.deadline <= now) {
      this.logger.info('Rejecting proposal: deadline expired', {
        proposalId: proposal.id,
        deadline: proposal.deadline.toString(),
        now: now.toString(),
      })
      await consumer.markRejected(proposal.id, 'deadline_expired')
      await this.cleanupDipsRule(consumer, proposal)
      return
    }

    const allocation = activeAllocations.find(
      (a) => a.subgraphDeployment.id.bytes32 === proposal.subgraphDeploymentId.bytes32,
    )

    if (allocation) {
      await this.acceptWithExistingAllocation(consumer, proposal, allocation)
    } else {
      await this.acceptWithNewAllocation(consumer, proposal, activeAllocations)
    }
  }

  private async acceptWithExistingAllocation(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    allocation: Allocation,
  ): Promise<void> {
    this.logger.info('Accepting proposal with existing allocation', {
      proposalId: proposal.id,
      allocationId: allocation.id,
      deployment: proposal.subgraphDeploymentId.ipfsHash,
    })

    try {
      const receipt = await this.network.transactionManager.executeTransaction(
        async () =>
          this.network.contracts.SubgraphService.acceptIndexingAgreement.estimateGas(
            allocation.id,
            proposal.signedRca,
          ),
        async (gasLimit) =>
          this.network.contracts.SubgraphService.acceptIndexingAgreement(
            allocation.id,
            proposal.signedRca,
            { gasLimit },
          ),
        this.logger.child({
          function: 'SubgraphService.acceptIndexingAgreement',
          proposalId: proposal.id,
        }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        this.logger.warn(
          'Skipping proposal acceptance: network is paused or unauthorized',
          { proposalId: proposal.id, status: receipt },
        )
        return
      }

      await consumer.markAccepted(proposal.id)
      this.logger.info('Proposal accepted on-chain', {
        proposalId: proposal.id,
        allocationId: allocation.id,
        txHash: receipt.hash,
      })
    } catch (error) {
      await this.handleAcceptError(consumer, proposal, error)
    }
  }

  private async acceptWithNewAllocation(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    activeAllocations: Allocation[],
  ): Promise<void> {
    this.logger.info('Accepting proposal with new allocation (multicall)', {
      proposalId: proposal.id,
      deployment: proposal.subgraphDeploymentId.ipfsHash,
    })

    try {
      const currentEpoch = await this.network.contracts.EpochManager.currentEpoch()

      // Include both active and on-chain (closed) allocation IDs to avoid collisions
      const excludeIds = activeAllocations.map((a) => a.id)
      let allocationSigner: Signer | undefined
      let allocationId: Address | undefined

      for (let attempt = 0; attempt < 10; attempt++) {
        const result = uniqueAllocationID(
          this.network.transactionManager.wallet.mnemonic!.phrase,
          Number(currentEpoch),
          proposal.subgraphDeploymentId,
          excludeIds,
        )

        // Verify allocation doesn't already exist on-chain (e.g. closed allocations)
        const onchainAllocation =
          await this.network.contracts.SubgraphService.getAllocation(result.allocationId)
        if (onchainAllocation.createdAt === 0n) {
          allocationSigner = result.allocationSigner
          allocationId = result.allocationId
          break
        }

        this.logger.debug(
          'Generated allocation ID already exists on-chain, trying next',
          {
            proposalId: proposal.id,
            allocationId: result.allocationId,
            attempt,
          },
        )
        excludeIds.push(result.allocationId)
      }

      if (!allocationSigner || !allocationId) {
        this.logger.warn('Could not generate unique allocation ID after 10 attempts', {
          proposalId: proposal.id,
        })
        return
      }

      // Generate allocation proof
      const chainId = Number(this.network.specification.networkIdentifier.split(':')[1])
      const proof = await horizonAllocationIdProof(
        allocationSigner,
        chainId,
        this.network.specification.indexerOptions.address,
        allocationId,
        this.network.contracts.SubgraphService.target.toString(),
      )

      // Build startService calldata
      const { amount, isDenied } = await this.getDipsAllocationAmount(
        proposal.subgraphDeploymentId,
      )
      this.logger.info('Determined allocation amount for DIPS agreement', {
        proposalId: proposal.id,
        deployment: proposal.subgraphDeploymentId.ipfsHash,
        amount: amount.toString(),
        isDenied,
      })
      const encodedStartData = encodeStartServiceData(
        proposal.subgraphDeploymentId.bytes32,
        amount,
        allocationId,
        proof,
      )
      const startServiceTx =
        await this.network.contracts.SubgraphService.startService.populateTransaction(
          this.network.specification.indexerOptions.address,
          encodedStartData,
        )

      // Build acceptIndexingAgreement calldata
      const acceptTx =
        await this.network.contracts.SubgraphService.acceptIndexingAgreement.populateTransaction(
          allocationId,
          proposal.signedRca,
        )

      // Atomic multicall
      const calldata = [startServiceTx.data!, acceptTx.data!]
      const receipt = await this.network.transactionManager.executeTransaction(
        async () =>
          this.network.contracts.SubgraphService.multicall.estimateGas(calldata),
        async (gasLimit) =>
          this.network.contracts.SubgraphService.multicall(calldata, { gasLimit }),
        this.logger.child({
          function: 'SubgraphService.multicall(startService+acceptIndexingAgreement)',
          proposalId: proposal.id,
        }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        this.logger.warn(
          'Skipping proposal acceptance: network is paused or unauthorized',
          { proposalId: proposal.id, status: receipt },
        )
        return
      }

      await consumer.markAccepted(proposal.id)
      this.logger.info('Proposal accepted on-chain with new allocation', {
        proposalId: proposal.id,
        allocationId,
        txHash: receipt.hash,
      })
    } catch (error) {
      await this.handleAcceptError(consumer, proposal, error)
    }
  }

  async collectAgreementPayments(): Promise<void> {
    const logger = this.logger.child({ function: 'collectAgreementPayments' })
    const indexerAddress = this.network.specification.indexerOptions.address

    const agreements = await fetchCollectableAgreements(
      this.network.networkSubgraph,
      indexerAddress,
    )

    if (agreements.length === 0) {
      logger.debug('No collectable agreements found')
      return
    }

    // Use chain timestamp for consistency with contract timing and subgraph data
    const blockNumber = await this.network.networkProvider.getBlockNumber()
    const block = await this.network.networkProvider.getBlock(blockNumber)
    const nowSeconds = block ? Number(block.timestamp) : Math.floor(Date.now() / 1000)

    // Sync tracker state from subgraph data
    for (const agreement of agreements) {
      this.collectionTracker.track(agreement.id, {
        lastCollectedAt: Number(agreement.lastCollectionAt),
        minSecondsPerCollection: agreement.minSecondsPerCollection,
        maxSecondsPerCollection: agreement.maxSecondsPerCollection,
      })
    }

    const readyIds = this.collectionTracker.getReadyAgreements(nowSeconds)
    if (readyIds.length === 0) {
      logger.debug('No agreements ready for collection', {
        total: agreements.length,
      })
      return
    }

    logger.info(
      `${readyIds.length} of ${agreements.length} agreement(s) ready for collection`,
    )

    const readyAgreements = agreements.filter((a) => readyIds.includes(a.id))

    for (const agreement of readyAgreements) {
      try {
        await this.tryCollectAgreement(agreement, blockNumber, logger)
        this.collectionTracker.updateAfterCollection(agreement.id, nowSeconds)
      } catch (err) {
        if (this.isDeterministicError(err)) {
          const parsedError = tryParseCustomError(err)
          logger.warn('Deterministic error collecting agreement, skipping', {
            agreementId: agreement.id,
            error: parsedError,
          })
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err)
          const errorStack = err instanceof Error ? err.stack : undefined
          logger.warn('Transient error collecting agreement, will retry', {
            agreementId: agreement.id,
            error: errorMsg,
            stack: errorStack,
          })
        }
      }
    }
  }

  private async tryCollectAgreement(
    agreement: SubgraphIndexingAgreement,
    blockNumber: number,
    logger: Logger,
  ): Promise<void> {
    const deploymentId = new SubgraphDeploymentID(agreement.subgraphDeploymentId)
    const entityCounts = await this.graphNode.entityCount([deploymentId])
    const entities = entityCounts[0]

    const recentBlock = blockNumber - 10
    const { network: networkAlias } = await this.graphNode.subgraphFeatures(deploymentId)
    const blockHash = await this.graphNode.blockHashFromNumber(networkAlias!, recentBlock)
    const poi = await this.graphNode.proofOfIndexing(
      deploymentId,
      { number: recentBlock, hash: blockHash },
      this.network.specification.indexerOptions.address,
    )

    if (!poi) {
      logger.warn('Could not get POI for agreement, using zero POI', {
        agreementId: agreement.id,
        deployment: deploymentId.ipfsHash,
      })
    }

    const effectivePoi =
      poi || '0x0000000000000000000000000000000000000000000000000000000000000000'

    const abiCoder = AbiCoder.defaultAbiCoder()

    const collectData = abiCoder.encode(
      ['(uint256,bytes32,uint256,bytes,uint256)'],
      [[entities, effectivePoi, recentBlock, '0x', MaxUint256]],
    )

    const data = abiCoder.encode(['bytes16', 'bytes'], [agreement.id, collectData])

    const indexerAddress = this.network.specification.indexerOptions.address
    const receipt = await this.network.transactionManager.executeTransaction(
      async () =>
        this.network.contracts.SubgraphService.collect.estimateGas(
          indexerAddress,
          PaymentTypes.IndexingFee,
          data,
        ),
      async (gasLimit) =>
        this.network.contracts.SubgraphService.collect(
          indexerAddress,
          PaymentTypes.IndexingFee,
          data,
          { gasLimit },
        ),
      logger.child({
        function: 'SubgraphService.collect',
        agreementId: agreement.id,
      }),
    )

    if (receipt === 'paused' || receipt === 'unauthorized') {
      logger.warn('Cannot collect: network paused or unauthorized', {
        agreementId: agreement.id,
        result: receipt,
      })
      return
    }

    logger.info('Successfully collected indexing fees', {
      agreementId: agreement.id,
      txHash: receipt.hash,
      deployment: deploymentId.ipfsHash,
      entities,
    })
  }

  private async handleAcceptError(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    error: unknown,
  ): Promise<void> {
    if (this.isDeterministicError(error)) {
      const parsedError = tryParseCustomError(error)
      const callException = error as {
        reason?: string
        data?: string
        message?: string
        transaction?: { to?: string; data?: string }
      }
      this.logger.warn('Rejecting proposal: deterministic contract error', {
        proposalId: proposal.id,
        deployment: proposal.subgraphDeploymentId.ipfsHash,
        error: parsedError,
        revertReason: callException.reason ?? null,
        revertData: callException.data ?? null,
        errorMessage: callException.message ?? null,
        contractTarget: callException.transaction?.to ?? null,
      })
      await consumer.markRejected(proposal.id, String(parsedError))
      await this.cleanupDipsRule(consumer, proposal)
    } else {
      this.logger.warn('Transient error accepting proposal, will retry', {
        proposalId: proposal.id,
        error,
      })
    }
  }

  private isDeterministicError(error: unknown): boolean {
    const typedError = error as { code?: string }
    return typedError?.code === 'CALL_EXCEPTION'
  }

  private async cleanupDipsRule(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
  ): Promise<void> {
    const otherProposalsForDeployment = await consumer.getPendingProposalsForDeployment(
      proposal.subgraphDeploymentId.bytes32,
    )

    if (otherProposalsForDeployment.length === 0) {
      const rule = await this.models.IndexingRule.findOne({
        where: {
          identifier: proposal.subgraphDeploymentId.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      if (rule) {
        await this.models.IndexingRule.destroy({ where: { id: rule.id } })
        this.logger.info('Removed DIPS indexing rule after rejection', {
          proposalId: proposal.id,
          deployment: proposal.subgraphDeploymentId.ipfsHash,
        })
      }
    }
  }

  private async ensureAgreementRulesFromLegacy() {
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
      const ruleExists = await this.parent!.matchingRuleExists(
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

  startProposalAcceptanceLoop() {
    if (!this.pendingRcaConsumer) {
      this.logger.debug('No pending RCA consumer configured, skipping acceptance loop')
      return
    }
    const consumer = this.pendingRcaConsumer

    sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: DIPS_ACCEPTANCE_INTERVAL,
      },
      async () => {
        const proposals = await consumer.getPendingProposals()
        if (proposals.length === 0) {
          return
        }

        this.logger.info('Processing pending RCA proposals for on-chain acceptance', {
          count: proposals.length,
        })

        const activeAllocations = await this.network.networkMonitor.allocations(
          AllocationStatus.ACTIVE,
        )

        for (const proposal of proposals) {
          try {
            await this.processProposal(consumer, proposal, activeAllocations)
          } catch (error) {
            this.logger.error('Unexpected error processing proposal', {
              proposalId: proposal.id,
              error,
            })
          }
        }
      },
      {
        onError: (err) => {
          this.logger.error('Failed to process pending RCA proposals', { err })
        },
      },
    )
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
