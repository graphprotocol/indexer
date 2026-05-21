import {
  Address,
  formatGRT,
  Logger,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationManager,
  GraphNode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  SubgraphIdentifierType,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'

import { PendingRcaProposal } from '../indexer-management/models/pending-rca-proposal'
import { PendingRcaConsumer } from './pending-rca-consumer'
import { DecodedRcaProposal } from './types'
import { tryParseCustomError } from '../utils'
import { uniqueAllocationID, horizonAllocationIdProof } from '../allocations/keys'
import { encodeStartServiceData, PaymentTypes } from '@graphprotocol/toolshed'
import { AbiCoder, Signer } from 'ethers'
import {
  fetchCollectableAgreements,
  SubgraphIndexingAgreement,
} from './agreement-monitor'
import { CollectionTracker } from './collection-tracker'
import { OfferVerifier } from './offer-verifier'

// POIs are computed against a recent-but-not-tip block to avoid reorg edge cases.
const RECENT_BLOCK_OFFSET = 10

export class DipsManager {
  declare pendingRcaConsumer: PendingRcaConsumer
  declare collectionTracker: CollectionTracker
  declare offerVerifier: OfferVerifier | null
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private network: Network,
    private graphNode: GraphNode,
    private parent: AllocationManager | null,
    pendingRcaModel: typeof PendingRcaProposal,
  ) {
    this.pendingRcaConsumer = new PendingRcaConsumer(this.logger, pendingRcaModel)
    this.collectionTracker = new CollectionTracker(
      this.network.specification.indexerOptions.dipsCollectionTarget,
    )
    this.offerVerifier = this.network.indexingPaymentsSubgraph
      ? new OfferVerifier(this.network.indexingPaymentsSubgraph, this.logger)
      : null
  }
  async ensureAgreementRules() {
    if (!this.parent) {
      this.logger.error(
        'DipsManager has no parent AllocationManager, cannot ensure agreement rules',
      )
      return
    }

    const { fromPendingProposals, fromActiveAgreements, deployments } =
      await this.getDipsTargetDeployments()

    this.logger.debug(
      `Ensuring DIPS indexing rules: ${fromPendingProposals.length} pending, ` +
        `${fromActiveAgreements.length} active accepted, ${deployments.length} unique deployments`,
    )

    const allDeploymentRules = await this.models.IndexingRule.findAll({
      where: { identifierType: SubgraphIdentifierType.DEPLOYMENT },
    })

    // Ensure a DIPS rule exists per target deployment
    for (const proposal of fromPendingProposals) {
      const deploymentId = proposal.subgraphDeploymentId
      const blocklisted = allDeploymentRules.find((r) =>
        this.isOnChainOptOutRule(r, deploymentId),
      )
      if (blocklisted) {
        this.logger.info(
          `Blocklisted deployment ${deploymentId.toString()}, rejecting proposal ${
            proposal.id
          }`,
        )
        await this.pendingRcaConsumer.markRejected(proposal.id, 'deployment blocklisted')
        continue
      }
      await this.upsertDipsRuleFor(deploymentId, {
        allocationLifetime: Math.max(
          Number(proposal.minSecondsPerCollection),
          Number(proposal.maxSecondsPerCollection),
        ),
      })
    }

    for (const agreement of fromActiveAgreements) {
      const deploymentId = new SubgraphDeploymentID(agreement.subgraphDeploymentId)
      const blocklisted = allDeploymentRules.find((r) =>
        this.isOnChainOptOutRule(r, deploymentId),
      )
      if (blocklisted) {
        // Cannot undo on-chain acceptance via a local rule; cancelBlocklistedAgreements
        // (in collectAgreementPayments) handles the on-chain cancel separately.
        this.logger.debug(
          `Blocklisted accepted agreement ${agreement.id}; rule creation skipped`,
        )
        continue
      }
      await this.upsertDipsRuleFor(deploymentId, {
        allocationLifetime: Math.max(
          Number(agreement.minSecondsPerCollection),
          Number(agreement.maxSecondsPerCollection),
        ),
      })
    }

    // Drop DIPS rules whose deployment is no longer in the target set.
    const targetSet = new Set(deployments.map((d) => d.bytes32))
    const dipsRules = await this.models.IndexingRule.findAll({
      where: {
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.DIPS,
      },
    })
    for (const rule of dipsRules) {
      const ruleDeploymentId = new SubgraphDeploymentID(rule.identifier)
      if (!targetSet.has(ruleDeploymentId.bytes32)) {
        this.logger.info(
          `Removing stale DIPS indexing rule for deployment ${ruleDeploymentId.toString()}`,
        )
        await this.models.IndexingRule.destroy({ where: { id: rule.id } })
      }
    }
  }

  private async upsertDipsRuleFor(
    deploymentId: SubgraphDeploymentID,
    opts: { allocationLifetime: number },
  ): Promise<void> {
    const ruleExists = await this.parent!.matchingRuleExists(this.logger, deploymentId)
    if (ruleExists) {
      return
    }

    const { amount } = await this.getDipsAllocationAmount(deploymentId)
    this.logger.info(
      `Creating DIPS indexing rule for deployment ${deploymentId.toString()}`,
    )
    await upsertIndexingRule(this.logger, this.models, {
      identifier: deploymentId.ipfsHash,
      allocationAmount: formatGRT(amount),
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.DIPS,
      protocolNetwork: this.network.specification.networkIdentifier,
      autoRenewal: true,
      allocationLifetime: opts.allocationLifetime,
      requireSupported: false,
    } as Partial<IndexingRuleAttributes>)
  }

  private async getDipsTargetDeployments(): Promise<{
    fromPendingProposals: DecodedRcaProposal[]
    fromActiveAgreements: SubgraphIndexingAgreement[]
    deployments: SubgraphDeploymentID[]
  }> {
    const fromPendingProposals = await this.pendingRcaConsumer.getPendingProposals()

    let fromActiveAgreements: SubgraphIndexingAgreement[] = []
    if (this.network.indexingPaymentsSubgraph) {
      const indexerAddress = this.network.specification.indexerOptions.address
      const all = await fetchCollectableAgreements(
        this.network.indexingPaymentsSubgraph,
        indexerAddress,
      )
      const nowSeconds = Math.floor(Date.now() / 1000)
      fromActiveAgreements = all.filter(
        (a) =>
          a.state === 'Accepted' &&
          (Number(a.endsAt) === 0 || Number(a.endsAt) > nowSeconds),
      )
    } else {
      this.logger.warn(
        'Indexing payments subgraph not configured; only pending proposals will drive DIPS rules',
      )
    }

    const seen = new Set<string>()
    const deployments: SubgraphDeploymentID[] = []
    for (const p of fromPendingProposals) {
      const key = p.subgraphDeploymentId.bytes32
      if (!seen.has(key)) {
        seen.add(key)
        deployments.push(p.subgraphDeploymentId)
      }
    }
    for (const a of fromActiveAgreements) {
      const id = new SubgraphDeploymentID(a.subgraphDeploymentId)
      if (!seen.has(id.bytes32)) {
        seen.add(id.bytes32)
        deployments.push(id)
      }
    }

    return { fromPendingProposals, fromActiveAgreements, deployments }
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

  async acceptPendingProposals(activeAllocations: Allocation[]): Promise<void> {
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

    if (!this.offerVerifier) {
      this.logger.error(
        'Indexing payments subgraph not configured; on-chain accept pre-flight cannot run. ' +
          'Set indexingPaymentsSubgraph in the network specification. ' +
          'Proposal remains pending until configuration is fixed.',
        { proposalId: proposal.id, agreementId: proposal.agreementId },
      )
      return
    }

    const expectedHash = await this.computeRcaHash(proposal)
    const offerResult = await this.offerVerifier.checkOffer(
      proposal.agreementId,
      expectedHash,
    )

    if (offerResult.status === 'not_yet') {
      this.logger.debug('Offer not yet on subgraph; leaving proposal pending', {
        proposalId: proposal.id,
        agreementId: proposal.agreementId,
      })
      return
    }

    if (offerResult.status === 'unavailable') {
      // OfferVerifier already logged at warn; just leave the row pending.
      return
    }

    if (offerResult.status === 'hash_mismatch') {
      this.logger.warn(
        'Rejecting proposal: on-chain offerHash does not match local RCA hash',
        {
          proposalId: proposal.id,
          agreementId: proposal.agreementId,
          onChainHash: offerResult.onChainHash,
          expectedHash,
        },
      )
      await consumer.markRejected(proposal.id, 'offer_hash_mismatch')
      await this.cleanupDipsRule(consumer, proposal)
      return
    }

    // offerResult.status === 'present' — proceed to accept.

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

    const rca = this.toContractRca(proposal)

    try {
      const receipt = await this.network.transactionManager.executeTransaction(
        async () =>
          this.network.contracts.SubgraphService.acceptIndexingAgreement.estimateGas(
            allocation.id,
            rca,
            '0x',
          ),
        async (gasLimit) =>
          this.network.contracts.SubgraphService.acceptIndexingAgreement(
            allocation.id,
            rca,
            '0x',
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
      const rca = this.toContractRca(proposal)
      const acceptTx =
        await this.network.contracts.SubgraphService.acceptIndexingAgreement.populateTransaction(
          allocationId,
          rca,
          '0x',
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

  // Returns true once the final-collect step ran (whether we canceled on-chain
  // or the payer already had); false only when our own on-chain cancel failed.
  async cancelAgreement(
    agreementId: string,
    agreement: SubgraphIndexingAgreement,
  ): Promise<boolean> {
    const logger = this.logger.child({
      function: 'cancelAgreement',
      agreementId,
    })

    // Step 1: Cancel on-chain (skipped if payer already canceled).
    const indexerAddress = this.network.specification.indexerOptions.address
    if (agreement.state === 'CanceledByPayer') {
      logger.info(
        'Payer already canceled on-chain; skipping cancel, proceeding to final collection',
      )
    } else {
      try {
        const receipt = await this.network.transactionManager.executeTransaction(
          async () =>
            this.network.contracts.SubgraphService.cancelIndexingAgreement.estimateGas(
              indexerAddress,
              agreementId,
            ),
          async (gasLimit) =>
            this.network.contracts.SubgraphService.cancelIndexingAgreement(
              indexerAddress,
              agreementId,
              { gasLimit },
            ),
          logger.child({ function: 'SubgraphService.cancelIndexingAgreement' }),
        )

        if (receipt === 'paused' || receipt === 'unauthorized') {
          logger.warn('Cannot cancel: network paused or unauthorized')
          return false
        }

        logger.info('Successfully cancelled agreement on-chain', {
          txHash: receipt.hash,
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error('Failed to cancel agreement on-chain', { error: errorMsg })
        return false
      }
    }

    // Step 2: Best-effort final collection
    try {
      const blockNumber = await this.network.networkProvider.getBlockNumber()
      await this.tryCollectAgreement(agreement, blockNumber, logger)
      logger.info('Final collection succeeded after cancel')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error('Final collection after cancel failed, fees may be lost', {
        deployment: agreement.subgraphDeploymentId,
        error: errorMsg,
      })
    }

    // Step 3: Cleanup
    this.collectionTracker.remove(agreementId)

    return true
  }

  async cancelBlocklistedAgreements(
    agreements: SubgraphIndexingAgreement[],
  ): Promise<void> {
    const logger = this.logger.child({
      function: 'cancelBlocklistedAgreements',
    })

    const allDeploymentRules = await this.models.IndexingRule.findAll({
      where: {
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
      },
    })

    for (const agreement of agreements) {
      // Only act on actively-collectable agreements. Anything else is
      // either pre-acceptance, already canceled, or otherwise terminal —
      // the regular collection loop handles the final-collect step.
      if (agreement.state !== 'Accepted') {
        continue
      }
      const subgraphDeploymentID = new SubgraphDeploymentID(
        agreement.subgraphDeploymentId,
      )
      const blocklistedRule = allDeploymentRules.find((rule) =>
        this.isOnChainOptOutRule(rule, subgraphDeploymentID),
      )

      if (blocklistedRule) {
        logger.info('Cancelling blocklisted agreement', {
          agreementId: agreement.id,
          deployment: subgraphDeploymentID.display,
        })
        await this.cancelAgreement(agreement.id, agreement)
      }
    }
  }

  async collectAgreementPayments(): Promise<void> {
    const logger = this.logger.child({ function: 'collectAgreementPayments' })
    const indexerAddress = this.network.specification.indexerOptions.address

    if (!this.network.indexingPaymentsSubgraph) {
      logger.warn(
        'Indexing payments subgraph not configured, skipping agreement collection',
      )
      return
    }
    const agreements = await fetchCollectableAgreements(
      this.network.indexingPaymentsSubgraph,
      indexerAddress,
    )

    if (agreements.length === 0) {
      logger.debug('No collectable agreements found')
      return
    }

    // Cancel any agreements whose deployments are blocklisted
    await this.cancelBlocklistedAgreements(agreements)

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
        const result = await this.tryCollectAgreement(agreement, blockNumber, logger)
        if (result === 'collected') {
          this.collectionTracker.updateAfterCollection(agreement.id, nowSeconds)
          this.cleanupFinishedAgreement(agreement, nowSeconds, logger)
        }
        // 'paused' / 'unauthorized' are pre-flight checks; no on-chain attempt was
        // made, so don't bump the tracker. Next tick will retry immediately.
      } catch (err) {
        const isDeterministic = this.isDeterministicError(err)
        const errorDetail = isDeterministic
          ? tryParseCustomError(err)
          : err instanceof Error
          ? err.message
          : String(err)
        // Throttle the retry so we don't hammer the chain on every poll cycle.
        // Deterministic errors during collection are typically recoverable
        // (subgraph sync, allocation reconcile, provision changes), so we
        // don't auto-cancel; we just slow down.
        this.collectionTracker.markAttempted(agreement.id, nowSeconds)
        logger.warn('Failed to collect agreement, will retry after throttle', {
          agreementId: agreement.id,
          error: errorDetail,
          deterministic: isDeterministic,
        })
      }
    }
  }

  cleanupFinishedAgreement(
    agreement: SubgraphIndexingAgreement,
    nowSeconds: number,
    logger: Logger,
  ): boolean {
    const isCancelledByPayer = agreement.state === 'CanceledByPayer'
    const isExpired =
      Number(agreement.endsAt) > 0 && Number(agreement.endsAt) < nowSeconds

    if (isCancelledByPayer || isExpired) {
      logger.info('Agreement finished, removing from collection tracker', {
        agreementId: agreement.id,
        reason: isCancelledByPayer ? 'payer-cancelled' : 'expired',
      })
      this.collectionTracker.remove(agreement.id)
      return true
    }
    return false
  }

  private async tryCollectAgreement(
    agreement: SubgraphIndexingAgreement,
    blockNumber: number,
    logger: Logger,
  ): Promise<'collected' | 'paused' | 'unauthorized'> {
    const deploymentId = new SubgraphDeploymentID(agreement.subgraphDeploymentId)
    const entityCounts = await this.graphNode.entityCount([deploymentId])
    const entities = entityCounts[0]

    const recentBlock = blockNumber - RECENT_BLOCK_OFFSET
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

    // Mirror SubgraphService._tokensToCollect to compute the data-service ask, then derive
    // an absolute slippage cap as a percentage of that ask. Slippage = ask − payer-cap;
    // dipsCollectionSlippage is the largest fraction of the ask we'll accept losing to
    // the payer's RCA limits in a single collection.
    const [, collectionSeconds] =
      await this.network.contracts.RecurringCollector.getCollectionInfo(agreement.id)
    const expectedTokens =
      collectionSeconds *
      (BigInt(agreement.tokensPerSecond) +
        BigInt(agreement.tokensPerEntityPerSecond) * BigInt(entities))
    const slippagePct = BigInt(
      this.network.specification.indexerOptions.dipsCollectionSlippage,
    )
    const maxSlippage = (expectedTokens * slippagePct) / 100n

    const abiCoder = AbiCoder.defaultAbiCoder()

    const collectData = abiCoder.encode(
      ['tuple(uint256,bytes32,uint256,bytes,uint256)'],
      [[entities, effectivePoi, recentBlock, '0x', maxSlippage]],
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
      return receipt
    }

    logger.info('Successfully collected indexing fees', {
      agreementId: agreement.id,
      txHash: receipt.hash,
      deployment: deploymentId.ipfsHash,
      entities,
    })
    return 'collected'
  }

  private toContractRca(proposal: DecodedRcaProposal) {
    return {
      deadline: proposal.deadline,
      endsAt: proposal.endsAt,
      payer: proposal.payer,
      dataService: proposal.dataService,
      serviceProvider: proposal.serviceProvider,
      maxInitialTokens: proposal.maxInitialTokens,
      maxOngoingTokensPerSecond: proposal.maxOngoingTokensPerSecond,
      minSecondsPerCollection: proposal.minSecondsPerCollection,
      maxSecondsPerCollection: proposal.maxSecondsPerCollection,
      conditions: proposal.conditions,
      nonce: proposal.nonce,
      metadata: proposal.metadata,
    }
  }

  private async computeRcaHash(proposal: DecodedRcaProposal): Promise<string> {
    return this.network.contracts.RecurringCollector.hashRCA(this.toContractRca(proposal))
  }

  private async handleAcceptError(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    error: unknown,
  ): Promise<void> {
    if (this.isDeterministicError(error)) {
      const parsedError = tryParseCustomError(error)
      this.logger.warn('Rejecting proposal: deterministic contract error', {
        proposalId: proposal.id,
        error: parsedError,
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

  private isOnChainOptOutRule(
    rule: IndexingRuleAttributes,
    deploymentId: SubgraphDeploymentID,
  ): boolean {
    return (
      new SubgraphDeploymentID(rule.identifier).bytes32 === deploymentId.bytes32 &&
      (rule.decisionBasis === IndexingDecisionBasis.NEVER ||
        rule.decisionBasis === IndexingDecisionBasis.OFFCHAIN)
    )
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

  async getActiveDipsDeployments(): Promise<SubgraphDeploymentID[]> {
    const { deployments } = await this.getDipsTargetDeployments()
    return deployments
  }
}
