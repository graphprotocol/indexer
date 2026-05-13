import {
  Address,
  formatGRT,
  Logger,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationManager,
  AllocationStatus,
  GraphNode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  SubgraphIdentifierType,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import pMap from 'p-map'

import { PendingRcaProposal } from '../indexer-management/models/pending-rca-proposal'
import { OfferMonitor } from './offer-monitor'
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

const DIPS_ACCEPTANCE_INTERVAL = 5_000
// POIs are computed against a recent-but-not-tip block to avoid reorg edge cases.
const RECENT_BLOCK_OFFSET = 10
const DIPS_SWEEP_INTERVAL = 60_000
// If the indexing-payments-subgraph is more than this many seconds behind
// wall-clock, treat its data as unreliable and skip the sweep this tick.
// Normal indexing lag should never approach this; anything older indicates
// the subgraph is broken / paused / disconnected.
const DIPS_SWEEP_STALENESS_THRESHOLD_SECONDS = 300
// Per-tick parallelism cap. Proposals target distinct agreementIds and the
// wallet's nonce queue serialises submissions, so concurrent processProposal
// calls are safe; small enough that a stuck call doesn't head-of-line others.
const DIPS_ACCEPT_CONCURRENCY = 4
// When the offer hasn't landed on-chain yet, keep retrying until the RCA
// deadline is within this window. Inside the window, give up cleanly so
// reassessment can pick a replacement before the deadline lapses.
const OFFER_GATE_DEADLINE_SAFETY_MARGIN_SECONDS = 30n

const elapsedMs = (start: bigint): number =>
  Number(process.hrtime.bigint() - start) / 1_000_000

export class DipsManager {
  declare pendingRcaConsumer: PendingRcaConsumer
  declare collectionTracker: CollectionTracker
  declare offerMonitor: OfferMonitor | null
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private network: Network,
    private graphNode: GraphNode,
    private parent: AllocationManager | null,
    pendingRcaModel: typeof PendingRcaProposal,
  ) {
    this.pendingRcaConsumer = new PendingRcaConsumer(this.logger, pendingRcaModel)

    // Null when no indexing-payments-subgraph is configured; processProposal
    // skips the offer-existence gate in that case.
    this.offerMonitor = this.network.indexingPaymentsSubgraph
      ? new OfferMonitor(this.logger, this.network.indexingPaymentsSubgraph)
      : null

    this.collectionTracker = new CollectionTracker(
      this.network.specification.indexerOptions.dipsCollectionTarget,
    )
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

    // Deploy must precede the on-chain allocation: reconcile reads
    // graph_node.indexingStatus, and an undefined status triggers
    // failsHealthCheck → spurious unallocate. Idempotent; graph-node
    // dedupes redundant calls across proposals sharing a deployment.
    await this.graphNode.ensure(
      `indexer-agent/${deploymentId.ipfsHash.slice(-10)}`,
      deploymentId,
    )

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
    const t0 = process.hrtime.bigint()
    const phases: Record<string, number> = {}
    const logSummary = (outcome: string) => {
      this.logger.info('processProposal completed', {
        proposalId: proposal.id,
        deployment: proposal.subgraphDeploymentId.ipfsHash,
        outcome,
        phases,
        totalMs: elapsedMs(t0),
      })
    }

    if (proposal.deadline <= now) {
      this.logger.info('Rejecting proposal: deadline expired', {
        proposalId: proposal.id,
        deadline: proposal.deadline.toString(),
        now: now.toString(),
      })
      await consumer.markRejected(proposal.id, 'deadline_expired')
      await this.cleanupDipsRule(consumer, proposal)
      logSummary('rejected_deadline_expired')
      return
    }

    // Create the dips rule eagerly here rather than leaving it to the reconcile
    // loop: the accept tx can confirm and clear the pending row before the next
    // reconcile tick, which would leave the rule uncreated and graph-node never
    // told to deploy the subgraph.
    const tRule = process.hrtime.bigint()
    const allDeploymentRules = await this.models.IndexingRule.findAll({
      where: { identifierType: SubgraphIdentifierType.DEPLOYMENT },
    })
    const blocklisted = allDeploymentRules.find((r) =>
      this.isOnChainOptOutRule(r, proposal.subgraphDeploymentId),
    )
    if (blocklisted) {
      this.logger.info(
        `Blocklisted deployment ${proposal.subgraphDeploymentId.toString()}, rejecting proposal ${
          proposal.id
        }`,
      )
      await consumer.markRejected(proposal.id, 'deployment blocklisted')
      phases.ruleMs = elapsedMs(tRule)
      logSummary('rejected_blocklisted')
      return
    }
    await this.upsertDipsRuleFor(proposal.subgraphDeploymentId, {
      allocationLifetime: Math.max(
        Number(proposal.minSecondsPerCollection),
        Number(proposal.maxSecondsPerCollection),
      ),
    })
    phases.ruleMs = elapsedMs(tRule)

    // Gate accept on the on-chain offer existing. If dipper's offer() tx was
    // evicted (nonce collision, gas spike), rcaOffers is empty and
    // acceptIndexingAgreement reverts with RecurringCollectorInvalidSigner —
    // a transient state, retry next tick. Inside the safety margin, give up
    // so reassessment can pick a replacement before the deadline lapses.
    if (this.offerMonitor) {
      const tOffer = process.hrtime.bigint()
      const offerOnChain = await this.offerMonitor.offerExists(proposal.id)
      phases.offerMs = elapsedMs(tOffer)
      if (!offerOnChain) {
        if (proposal.deadline > now + OFFER_GATE_DEADLINE_SAFETY_MARGIN_SECONDS) {
          this.logger.debug(
            'Offer not yet on-chain, waiting for next acceptance-loop tick',
            {
              proposalId: proposal.id,
              deadline: proposal.deadline.toString(),
              now: now.toString(),
            },
          )
          logSummary('waiting_for_offer')
          return
        }
        this.logger.warn(
          'Offer never landed on-chain within the RCA deadline, rejecting proposal',
          {
            proposalId: proposal.id,
            deadline: proposal.deadline.toString(),
            now: now.toString(),
          },
        )
        await consumer.markRejected(proposal.id, 'offer_never_landed')
        await this.cleanupDipsRule(consumer, proposal)
        logSummary('rejected_offer_never_landed')
        return
      }
    }

    const allocation = activeAllocations.find(
      (a) => a.subgraphDeployment.id.bytes32 === proposal.subgraphDeploymentId.bytes32,
    )

    const tAccept = process.hrtime.bigint()
    if (allocation) {
      await this.acceptWithExistingAllocation(consumer, proposal, allocation)
    } else {
      await this.acceptWithNewAllocation(consumer, proposal, activeAllocations)
    }
    phases.acceptMs = elapsedMs(tAccept)
    // The accept helpers swallow errors via handleAcceptError; per-outcome
    // log lines from inside them tell the actual story.
    logSummary('accept_attempted')
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
            proposal.signedRca.rca,
            proposal.signedRca.signature,
          ),
        async (gasLimit) =>
          this.network.contracts.SubgraphService.acceptIndexingAgreement(
            allocation.id,
            proposal.signedRca.rca,
            proposal.signedRca.signature,
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
          proposal.signedRca.rca,
          proposal.signedRca.signature,
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

    // Step 1: Cancel on-chain (skipped if payer already canceled — a second
    // cancel reverts on `InvalidAgreementState` and would skip the final collect).
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
      // Already-canceled agreements need a final collect, not another cancel —
      // the regular collection loop handles them. cancelAgreement also guards
      // this state internally as defense-in-depth.
      if (agreement.state === 'CanceledByPayer') {
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
    try {
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
    } catch (err) {
      // Catch outer fetch failures (subgraph query, RPC getBlockNumber/getBlock,
      // cancelBlocklistedAgreements) so a transient failure skips this tick rather
      // than aborting the entire reconcile cycle for every network.
      logger.warn('Skipping DIPs collection tick due to fetch failure', { err })
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

  private async handleAcceptError(
    consumer: PendingRcaConsumer,
    proposal: DecodedRcaProposal,
    error: unknown,
  ): Promise<void> {
    // ABI-level mismatches are deterministic; retrying for the full RCA
    // deadline only burns the budget. Mark rejected immediately so dipper
    // reassessment can pick a working candidate.
    const abiMismatchReason = this.classifyAbiMismatch(error)
    if (abiMismatchReason !== null) {
      const callException = error as { code?: string; message?: string }
      this.logger.warn('Rejecting proposal: ABI mismatch (non-recoverable)', {
        proposalId: proposal.id,
        deployment: proposal.subgraphDeploymentId.ipfsHash,
        reason: abiMismatchReason,
        ethersCode: callException.code ?? null,
        errorMessage: callException.message ?? null,
      })
      await consumer.markRejected(proposal.id, abiMismatchReason)
      await this.cleanupDipsRule(consumer, proposal)
      return
    }

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

  private classifyAbiMismatch(error: unknown): string | null {
    const typedError = error as { code?: string; operation?: string }
    if (
      typedError?.code === 'UNSUPPORTED_OPERATION' &&
      typedError?.operation === 'fragment'
    ) {
      return 'abi_fragment_mismatch'
    }
    if (typedError?.code === 'INVALID_ARGUMENT') {
      return 'abi_invalid_argument'
    }
    return null
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
          concurrency: DIPS_ACCEPT_CONCURRENCY,
        })

        const activeAllocations = await this.network.networkMonitor.allocations(
          AllocationStatus.ACTIVE,
        )

        // Run up to DIPS_ACCEPT_CONCURRENCY proposals in parallel. Each
        // processProposal call targets a distinct agreementId and has no
        // shared mutable state with the others. Per-proposal failures are
        // already isolated by handleAcceptError; the explicit try/catch
        // here defends against any unexpected throw escaping that.
        await pMap(
          proposals,
          async (proposal) => {
            try {
              await this.processProposal(consumer, proposal, activeAllocations)
            } catch (error) {
              this.logger.error('Unexpected error processing proposal', {
                proposalId: proposal.id,
                error,
              })
            }
          },
          { concurrency: DIPS_ACCEPT_CONCURRENCY, stopOnError: false },
        )
      },
      {
        onError: (err) => {
          this.logger.error('Failed to process pending RCA proposals', { err })
        },
      },
    )
  }

  /**
   * Query the indexing-payments-subgraph for the agent's accepted agreements
   * and the subgraph's current chain timestamp. Used by the allocation
   * sweep to verify that each `dips`-basis indexing rule has a paying
   * agreement backing it.
   */
  async fetchAcceptedAgreementsForSelf(): Promise<{
    deployments: Set<string>
    blockTimestamp: number | null
  }> {
    if (!this.network.indexingPaymentsSubgraph) {
      return { deployments: new Set(), blockTimestamp: null }
    }
    const indexer = this.network.specification.indexerOptions.address.toLowerCase()
    const result = await this.network.indexingPaymentsSubgraph.query(
      gql`
        query selfAgreements($indexer: String!) {
          _meta {
            block {
              timestamp
            }
          }
          indexingAgreements(where: { indexer: $indexer, state: Accepted }, first: 1000) {
            id
            subgraphDeploymentId
          }
        }
      `,
      { indexer },
    )
    if (result.error) {
      throw new Error(`indexing-payments query failed: ${result.error}`)
    }
    const data = result.data ?? {}
    const deployments = new Set<string>(
      (data.indexingAgreements ?? []).map((a: { subgraphDeploymentId: string }) =>
        a.subgraphDeploymentId.toLowerCase(),
      ),
    )
    const blockTimestamp = data._meta?.block?.timestamp ?? null
    return { deployments, blockTimestamp }
  }

  /**
   * Reconcile local `dips`-basis indexing rules against the
   * indexing-payments-subgraph. Each rule represents a deployment the
   * agent allocated to as part of a DIPs agreement. If the subgraph
   * cannot confirm an Accepted agreement for that deployment, the rule
   * is stale (the agent is allocated without payment, e.g. because
   * dipper marked the agreement Expired or the original on-chain accept
   * never linked back). The rule is deleted; the agent's normal
   * reconciliation closes the allocation through its existing path.
   *
   * The subgraph block timestamp is checked first: if the subgraph is
   * far behind wall-clock, the sweep is skipped this tick so we never
   * disable rules based on stale data.
   */
  async sweepDipsAllocations(): Promise<void> {
    if (!this.network.indexingPaymentsSubgraph) {
      return
    }
    const logger = this.logger.child({ function: 'sweepDipsAllocations' })

    let acceptedDeployments: Set<string>
    let blockTimestamp: number | null
    try {
      const result = await this.fetchAcceptedAgreementsForSelf()
      acceptedDeployments = result.deployments
      blockTimestamp = result.blockTimestamp
    } catch (err) {
      logger.warn('Skipping DIPs allocation sweep: subgraph query failed', {
        err,
      })
      return
    }

    if (blockTimestamp === null) {
      logger.warn(
        'Skipping DIPs allocation sweep: indexing-payments subgraph returned no _meta timestamp',
      )
      return
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const lag = nowSeconds - Number(blockTimestamp)
    if (lag > DIPS_SWEEP_STALENESS_THRESHOLD_SECONDS) {
      logger.warn('Skipping DIPs allocation sweep: indexing-payments subgraph is stale', {
        subgraphTimestamp: blockTimestamp,
        nowSeconds,
        lagSeconds: lag,
        thresholdSeconds: DIPS_SWEEP_STALENESS_THRESHOLD_SECONDS,
      })
      return
    }

    const dipsRules = await this.models.IndexingRule.findAll({
      where: {
        decisionBasis: IndexingDecisionBasis.DIPS,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
      },
    })

    let removed = 0
    for (const rule of dipsRules) {
      const deploymentBytes32 = new SubgraphDeploymentID(rule.identifier).bytes32
      const deploymentLower = deploymentBytes32.toLowerCase()
      if (acceptedDeployments.has(deploymentLower)) {
        continue
      }
      logger.warn(
        'Removing DIPs indexing rule with no backing agreement in indexing-payments-subgraph',
        {
          deployment: rule.identifier,
          subgraphTimestamp: blockTimestamp,
        },
      )
      await this.models.IndexingRule.destroy({ where: { id: rule.id } })
      removed += 1
    }

    if (removed > 0) {
      logger.info('DIPs allocation sweep removed stale rules', {
        removed,
        rulesChecked: dipsRules.length,
        acceptedAgreements: acceptedDeployments.size,
      })
    } else {
      logger.debug('DIPs allocation sweep: all dips rules backed', {
        rulesChecked: dipsRules.length,
        acceptedAgreements: acceptedDeployments.size,
      })
    }
  }

  startAllocationSweepLoop() {
    if (!this.network.indexingPaymentsSubgraph) {
      this.logger.debug(
        'No indexing-payments-subgraph configured, skipping DIPs allocation sweep loop',
      )
      return
    }

    sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: DIPS_SWEEP_INTERVAL,
      },
      async () => {
        await this.sweepDipsAllocations()
      },
      {
        onError: (err) => {
          this.logger.error('DIPs allocation sweep tick failed', { err })
        },
      },
    )
  }
}
