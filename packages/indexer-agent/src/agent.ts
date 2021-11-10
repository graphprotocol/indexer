/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  formatGRT,
  join,
  Logger,
  Metrics,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  allocationRewardsPool,
  Allocation,
  AllocationStatus,
  INDEXING_RULE_GLOBAL,
  IndexingRuleAttributes,
  RewardsPool,
  indexerError,
  IndexerErrorCode,
  POIDisputeAttributes,
} from '@graphprotocol/indexer-common'
import { BlockPointer, NetworkSubgraph } from '@graphprotocol/indexer-common'
import { Indexer } from './indexer'
import { AgentConfig } from './types'
import { Network } from './network'
import { BigNumber, utils } from 'ethers'
import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'
import { ReceiptCollector } from './query-fees'

const allocationInList = (
  list: Allocation[],
  allocation: Allocation,
): boolean => list.find(item => item.id === allocation.id) !== undefined

const deploymentInList = (
  list: SubgraphDeploymentID[],
  deployment: SubgraphDeploymentID,
): boolean =>
  list.find(item => item.bytes32 === deployment.bytes32) !== undefined

const uniqueDeploymentsOnly = (
  value: SubgraphDeploymentID,
  index: number,
  array: SubgraphDeploymentID[],
): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

const uniqueDeployments = (
  deployments: SubgraphDeploymentID[],
): SubgraphDeploymentID[] => deployments.filter(uniqueDeploymentsOnly)

class Agent {
  logger: Logger
  metrics: Metrics
  indexer: Indexer
  network: Network
  networkSubgraph: NetworkSubgraph
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector

  constructor(
    logger: Logger,
    metrics: Metrics,
    indexer: Indexer,
    network: Network,
    networkSubgraph: NetworkSubgraph,
    registerIndexer: boolean,
    offchainSubgraphs: SubgraphDeploymentID[],
    receiptCollector: ReceiptCollector,
  ) {
    this.logger = logger.child({ component: 'Agent' })
    this.metrics = metrics
    this.indexer = indexer
    this.network = network
    this.networkSubgraph = networkSubgraph
    this.registerIndexer = registerIndexer
    this.offchainSubgraphs = offchainSubgraphs
    this.receiptCollector = receiptCollector
  }

  async start(): Promise<Agent> {
    this.logger.info(`Connect to Graph node(s)`)
    await this.indexer.connect()
    this.logger.info(`Connected to Graph node(s)`)

    // Ensure there is a 'global' indexing rule
    await this.indexer.ensureGlobalIndexingRule()

    if (this.registerIndexer) {
      await this.network.register()
    }

    const currentEpoch = timer(600_000).tryMap(
      () => this.network.contracts.epochManager.currentEpoch(),
      {
        onError: err =>
          this.logger.warn(`Failed to fetch current epoch`, { err }),
      },
    )

    const currentEpochStartBlock = currentEpoch.tryMap(
      async () => {
        const startBlockNumber =
          await this.network.contracts.epochManager.currentEpochBlock()
        const startBlock = await this.network.ethereum.getBlock(
          startBlockNumber.toNumber(),
        )
        return {
          number: startBlock.number,
          hash: startBlock.hash,
        }
      },
      {
        onError: err =>
          this.logger.warn(`Failed to fetch start block of current epoch`, {
            err,
          }),
      },
    )

    const channelDisputeEpochs = timer(600_000).tryMap(
      () => this.network.contracts.staking.channelDisputeEpochs(),
      {
        onError: err =>
          this.logger.warn(`Failed to fetch channel dispute epochs`, { err }),
      },
    )

    const maxAllocationEpochs = timer(600_000).tryMap(
      () => this.network.contracts.staking.maxAllocationEpochs(),
      {
        onError: err =>
          this.logger.warn(`Failed to fetch max allocation epochs`, { err }),
      },
    )

    const indexingRules = timer(60_000).tryMap(
      () => this.indexer.indexingRules(true),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain indexing rules, trying again later`,
          ),
      },
    )

    const activeDeployments = timer(60_000).tryMap(
      () => this.indexer.subgraphDeployments(),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain active deployments, trying again later`,
          ),
      },
    )

    const targetDeployments = timer(120_000).tryMap(
      async () => {
        const rules = await indexingRules.value()

        // Identify subgraph deployments on the network that are worth picking up;
        // these may overlap with the ones we're already indexing
        return rules.length === 0
          ? []
          : await this.network.subgraphDeploymentsWorthIndexing(rules)
      },
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain target deployments, trying again later`,
          ),
      },
    )

    const activeAllocations = timer(120_000).tryMap(
      () => this.network.allocations(AllocationStatus.Active),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain active allocations, trying again later`,
          ),
      },
    )

    const claimableAllocations = join({
      currentEpoch,
      channelDisputeEpochs,
    }).tryMap(
      ({ currentEpoch, channelDisputeEpochs }) =>
        this.network.claimableAllocations(
          currentEpoch.toNumber() - channelDisputeEpochs,
        ),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain claimable allocations, trying again later`,
          ),
      },
    )
    this.logger.info(`Waiting for network data before reconciling every 120s`)

    const disputableAllocations = join({
      currentEpoch,
      activeDeployments,
    }).tryMap(
      ({ currentEpoch, activeDeployments }) =>
        this.network.disputableAllocations(currentEpoch, activeDeployments, 0),
      {
        onError: () =>
          this.logger.warn(
            `Failed to fetch disputable allocations, trying again later`,
          ),
      },
    )

    join({
      ticker: timer(120_000),
      paused: this.network.paused,
      isOperator: this.network.isOperator,
      currentEpoch,
      currentEpochStartBlock,
      maxAllocationEpochs,
      indexingRules,
      activeDeployments,
      targetDeployments,
      activeAllocations,
      claimableAllocations,
      disputableAllocations,
    }).pipe(
      async ({
        paused,
        isOperator,
        currentEpoch,
        currentEpochStartBlock,
        maxAllocationEpochs,
        indexingRules,
        activeDeployments,
        targetDeployments,
        activeAllocations,
        claimableAllocations,
        disputableAllocations,
      }) => {
        this.logger.info(`Reconcile with the network`)

        // Do nothing else if the network is paused
        if (paused) {
          return this.logger.info(
            `The network is currently paused, not doing anything until it resumes`,
          )
        }

        // Do nothing if we're not authorized as an operator for the indexer
        if (!isOperator) {
          return this.logger.error(
            `Not authorized as an operator for the indexer`,
            {
              err: indexerError(IndexerErrorCode.IE034),
              indexer: toAddress(this.network.indexerAddress),
              operator: toAddress(this.network.wallet.address),
            },
          )
        }

        // Claim rebate pool rewards from finalized allocations
        try {
          await this.claimRebateRewards(claimableAllocations)
        } catch (err) {
          this.logger.warn(`Failed to claim rebate rewards`, { err })
        }

        try {
          const disputableEpoch =
            currentEpoch.toNumber() - this.network.poiDisputableEpochs
          // Find disputable allocations
          await this.identifyPotentialDisputes(
            disputableAllocations,
            disputableEpoch,
          )
        } catch (err) {
          this.logger.warn(`Failed PoI dispute monitoring`, { err })
        }

        try {
          await this.reconcileDeployments(
            activeDeployments,
            targetDeployments,
            activeAllocations,
          )

          // Reconcile allocations
          await this.reconcileAllocations(
            activeAllocations,
            targetDeployments,
            indexingRules,
            currentEpoch.toNumber(),
            currentEpochStartBlock,
            maxAllocationEpochs,
          )
        } catch (err) {
          this.logger.warn(`Failed to reconcile indexer and network`, {
            err: indexerError(IndexerErrorCode.IE005, err),
          })
        }
      },
    )

    return this
  }

  async claimRebateRewards(allocations: Allocation[]): Promise<void> {
    this.logger.info(`Claim rebate rewards`, {
      claimable: allocations.map(allocation => ({
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })),
    })
    if (allocations.length > 0) {
      await this.network.claimMany(allocations)
    }
  }

  async identifyPotentialDisputes(
    disputableAllocations: Allocation[],
    disputableEpoch: number,
  ): Promise<void> {
    // TODO: Support supplying status = 'any' to fetchPOIDisputes() to fetch all previously processed allocations in a single query
    const alreadyProcessed = (
      await this.indexer.fetchPOIDisputes('potential', disputableEpoch)
    ).concat(await this.indexer.fetchPOIDisputes('valid', disputableEpoch))

    const newDisputableAllocations = disputableAllocations.filter(
      allocation =>
        !alreadyProcessed.find(
          dispute => dispute.allocationID == allocation.id,
        ),
    )
    if (newDisputableAllocations.length == 0) {
      this.logger.debug(
        'No new disputable allocations to process for potential disputes',
      )
      return
    }

    this.logger.debug(
      `Found new allocations onchain for subgraphs we have indexed. Let's compare PoIs to identify any potential indexing disputes`,
    )

    const uniqueRewardsPools: RewardsPool[] = await Promise.all(
      [
        ...new Set(
          newDisputableAllocations.map(allocation =>
            allocationRewardsPool(allocation),
          ),
        ),
      ]
        .filter(pool => pool.closedAtEpochStartBlockHash)
        .map(async pool => {
          const closedAtEpochStartBlock = await this.network.ethereum.getBlock(
            pool.closedAtEpochStartBlockHash!,
          )

          // Todo: Lazily fetch this, only if the first reference POI doesn't match
          const previousEpochStartBlock = await this.network.ethereum.getBlock(
            pool.previousEpochStartBlockHash!,
          )
          pool.closedAtEpochStartBlockNumber = closedAtEpochStartBlock.number
          pool.referencePOI = await this.indexer.proofOfIndexing(
            pool.subgraphDeployment,
            {
              number: closedAtEpochStartBlock.number,
              hash: closedAtEpochStartBlock.hash,
            },
            pool.allocationIndexer,
          )
          pool.previousEpochStartBlockHash = previousEpochStartBlock.hash
          pool.previousEpochStartBlockNumber = previousEpochStartBlock.number
          pool.referencePreviousPOI = await this.indexer.proofOfIndexing(
            pool.subgraphDeployment,
            {
              number: previousEpochStartBlock.number,
              hash: previousEpochStartBlock.hash,
            },
            pool.allocationIndexer,
          )
          return pool
        }),
    )

    const disputes: POIDisputeAttributes[] = newDisputableAllocations.map(
      (allocation: Allocation) => {
        const rewardsPool = uniqueRewardsPools.find(
          pool =>
            pool.subgraphDeployment == allocation.subgraphDeployment.id &&
            pool.closedAtEpoch == allocation.closedAtEpoch,
        )
        if (!rewardsPool) {
          throw Error(
            `No rewards pool found for deployment ${allocation.subgraphDeployment.id}`,
          )
        }

        let status =
          rewardsPool!.referencePOI == allocation.poi ||
          rewardsPool!.referencePreviousPOI == allocation.poi
            ? 'valid'
            : 'potential'

        if (
          status === 'potential' &&
          (!rewardsPool.referencePOI || !rewardsPool.referencePreviousPOI)
        ) {
          status = 'reference_unavailable'
        }

        return {
          allocationID: allocation.id,
          subgraphDeploymentID: allocation.subgraphDeployment.id.ipfsHash,
          allocationIndexer: allocation.indexer,
          allocationAmount: allocation.allocatedTokens.toString(),
          allocationProof: allocation.poi!,
          closedEpoch: allocation.closedAtEpoch,
          closedEpochReferenceProof: rewardsPool!.referencePOI,
          closedEpochStartBlockHash: allocation.closedAtEpochStartBlockHash!,
          closedEpochStartBlockNumber:
            rewardsPool!.closedAtEpochStartBlockNumber!,
          previousEpochReferenceProof: rewardsPool!.referencePreviousPOI,
          previousEpochStartBlockHash:
            rewardsPool!.previousEpochStartBlockHash!,
          previousEpochStartBlockNumber:
            rewardsPool!.previousEpochStartBlockNumber!,
          status,
        } as POIDisputeAttributes
      },
    )

    const potentialDisputes = disputes.filter(
      dispute => dispute.status == 'potential',
    ).length
    const stored = await this.indexer.storePoiDisputes(disputes)

    this.logger.info(`Disputable allocations' PoIs validated`, {
      potentialDisputes: potentialDisputes,
      validAllocations: stored.length - potentialDisputes,
    })
  }

  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
    activeAllocations: Allocation[],
  ): Promise<void> {
    activeDeployments = uniqueDeployments(activeDeployments)
    targetDeployments = uniqueDeployments(targetDeployments)
    const activeAllocationDeployments = uniqueDeployments(
      activeAllocations.map(allocation => allocation.subgraphDeployment.id),
    )

    // Ensure the network subgraph deployment is _always_ indexed
    if (this.networkSubgraph.deployment) {
      if (
        !deploymentInList(targetDeployments, this.networkSubgraph.deployment.id)
      ) {
        targetDeployments.push(this.networkSubgraph.deployment.id)
      }
    }

    // Ensure all offchain subgraphs are _always_ indexed
    for (const offchainSubgraph of this.offchainSubgraphs) {
      if (!deploymentInList(targetDeployments, offchainSubgraph)) {
        targetDeployments.push(offchainSubgraph)
      }
    }

    this.logger.info('Reconcile deployments', {
      active: activeDeployments.map(id => id.display),
      target: targetDeployments.map(id => id.display),
    })

    // Identify which subgraphs to deploy and which to remove
    const deploy = targetDeployments.filter(
      deployment => !deploymentInList(activeDeployments, deployment),
    )
    const remove = activeDeployments.filter(
      deployment =>
        !deploymentInList(targetDeployments, deployment) &&
        !deploymentInList(activeAllocationDeployments, deployment),
    )

    this.logger.info('Deployment changes', {
      deploy: deploy.map(id => id.display),
      remove: remove.map(id => id.display),
    })

    // Deploy/remove up to 10 subgraphs in parallel
    const queue = new PQueue({ concurrency: 10 })

    // Index all new deployments worth indexing
    await queue.addAll(
      deploy.map(deployment => async () => {
        const name = `indexer-agent/${deployment.ipfsHash.slice(-10)}`

        this.logger.info(`Index subgraph deployment`, {
          name,
          deployment: deployment.display,
        })

        // Ensure the deployment is deployed to the indexer
        // Note: we're not waiting here, as sometimes indexing a subgraph
        // will block if the IPFS files cannot be retrieved
        this.indexer.ensure(name, deployment)
      }),
    )

    // Stop indexing deployments that are no longer worth indexing
    await queue.addAll(
      remove.map(deployment => async () => this.indexer.remove(deployment)),
    )

    await queue.onIdle()
  }

  async reconcileAllocations(
    activeAllocations: Allocation[],
    targetDeployments: SubgraphDeploymentID[],
    rules: IndexingRuleAttributes[],
    currentEpoch: number,
    currentEpochStartBlock: BlockPointer,
    maxAllocationEpochs: number,
  ): Promise<void> {
    const allocationLifetime = Math.max(1, maxAllocationEpochs - 1)

    this.logger.info(`Reconcile allocations`, {
      currentEpoch,
      maxAllocationEpochs,
      allocationLifetime,
      active: activeAllocations.map(allocation => ({
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })),
    })

    // Calculate the union of active deployments and target deployments
    const deployments = uniqueDeployments([
      ...targetDeployments,
      ...activeAllocations.map(allocation => allocation.subgraphDeployment.id),
    ])

    // Ensure the network subgraph is never allocated towards
    if (this.networkSubgraph instanceof SubgraphDeploymentID) {
      const networkSubgraphDeployment = this.networkSubgraph
      targetDeployments = targetDeployments.filter(
        deployment => deployment.bytes32 !== networkSubgraphDeployment.bytes32,
      )
    }

    this.logger.debug(`Deployments to reconcile allocations for`, {
      number: deployments.length,
      deployments: deployments.map(deployment => deployment.display),
    })

    await pMap(
      deployments,
      async deployment => {
        await this.reconcileDeploymentAllocations(
          deployment,

          // Active allocations for the subgraph deployment
          activeAllocations.filter(
            allocation =>
              allocation.subgraphDeployment.id.bytes32 === deployment.bytes32,
          ),

          // Whether the deployment is worth indexing
          targetDeployments.find(
            target => target.bytes32 === deployment.bytes32,
          ) !== undefined,

          // Indexing rule for the deployment (if any)
          rules.find(rule => rule.deployment === deployment.bytes32) ||
            rules.find(rule => rule.deployment === INDEXING_RULE_GLOBAL),

          currentEpoch,
          currentEpochStartBlock,
          maxAllocationEpochs,
        )
      },
      { concurrency: 1 },
    )
  }

  async reconcileDeploymentAllocations(
    deployment: SubgraphDeploymentID,
    activeAllocations: Allocation[],
    worthIndexing: boolean,
    rule: IndexingRuleAttributes | undefined,
    epoch: number,
    epochStartBlock: BlockPointer,
    maxAllocationEpochs: number,
  ): Promise<void> {
    const logger = this.logger.child({
      deployment: deployment.display,
      epoch,
    })

    const allocationAmount = rule?.allocationAmount
      ? BigNumber.from(rule.allocationAmount)
      : this.indexer.defaultAllocationAmount
    const desiredNumberOfAllocations = Math.max(
      1,
      rule?.parallelAllocations || 1,
    )

    logger.info(`Reconcile deployment allocations`, {
      allocationAmount: formatGRT(allocationAmount),

      totalActiveAllocationAmount: formatGRT(
        activeAllocations.reduce(
          (sum, allocation) => sum.add(allocation.allocatedTokens),
          BigNumber.from('0'),
        ),
      ),

      desiredNumberOfAllocations,
      activeNumberOfAllocations: activeAllocations.length,

      activeAllocations: activeAllocations.map(allocation => ({
        id: allocation.id,
        createdAtEpoch: allocation.createdAtEpoch,
        amount: formatGRT(allocation.allocatedTokens),
      })),
    })

    // Return early if the deployment is not (or no longer) worth indexing
    if (!worthIndexing) {
      logger.info(
        `Deployment is not (or no longer) worth indexing, close all active allocations that are at least one epoch old`,
        {
          activeAllocations: activeAllocations.map(allocation => allocation.id),
          eligibleForClose: activeAllocations
            .filter(allocation => allocation.createdAtEpoch < epoch)
            .map(allocation => allocation.id),
        },
      )

      // Make sure to close all active allocations on the way out
      if (activeAllocations.length > 0) {
        await pMap(
          // We can only close allocations that are at least one epoch old;
          // try the others again later
          activeAllocations.filter(
            allocation => allocation.createdAtEpoch < epoch,
          ),
          async allocation => {
            await this.closeAllocation(epochStartBlock, allocation)
          },
          { concurrency: 1 },
        )
      }
      return
    }

    // If there are no allocations at all yet, create a new allocation
    if (activeAllocations.length === 0) {
      logger.info(`No active allocations for deployment, creating some now`, {
        desiredNumberOfAllocations,
        allocationAmount: formatGRT(allocationAmount),
      })
      const allocationsCreated = await this.network.allocate(
        deployment,
        allocationAmount,
        activeAllocations,
      )
      if (allocationsCreated) {
        await this.receiptCollector.rememberAllocations([allocationsCreated])
      }
      return
    }

    // Remove any parallel allocations (deprecated)
    const allocationsToRemove =
      activeAllocations.length - desiredNumberOfAllocations
    if (allocationsToRemove > 0) {
      logger.info(
        `Close allocations to maintain desired number of allocations`,
        {
          desiredNumberOfAllocations,
          activeAllocations: activeAllocations.length,
          allocationsToRemove: allocationsToRemove,
          allocationAmount: formatGRT(allocationAmount),
        },
      )
      await pMap(
        // We can only close allocations that are at least one epoch old; try the others again later
        // Close the oldest allocations first
        activeAllocations
          .filter(allocation => allocation.createdAtEpoch < epoch)
          .sort((a, b) => a.createdAtEpoch - b.closedAtEpoch)
          .splice(0, allocationsToRemove),
        async allocation => {
          await this.closeAllocation(epochStartBlock, allocation)
        },
        { concurrency: 1 },
      )
    }

    const lifetime = Math.max(1, maxAllocationEpochs - 1)

    // For allocations that have expired, let's reallocate in one transaction (closeAndAllocate)
    let expiredAllocations = activeAllocations.filter(
      allocation => epoch >= allocation.createdAtEpoch + lifetime,
    )
    // The allocations come from the network subgraph; due to short indexing
    // latencies, this data may be slightly outdated. Cross-check with the
    // contracts to avoid closing allocations that are already closed on
    // chain.
    expiredAllocations = await pFilter(
      expiredAllocations,
      async (allocation: Allocation) => {
        try {
          const onChainAllocation =
            await this.network.contracts.staking.getAllocation(allocation.id)
          return onChainAllocation.closedAtEpoch.eq('0')
        } catch (err) {
          this.logger.warn(
            `Failed to cross-check allocation state with contracts; assuming it needs to be closed`,
            {
              deployment: deployment.display,
              allocation: allocation.id,
              err: indexerError(IndexerErrorCode.IE006, err),
            },
          )
          return true
        }
      },
    )

    if (expiredAllocations.length > 0) {
      logger.info(`Reallocating expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map(allocation => allocation.id),
      })

      // We do a synchronous for-loop and await each iteration so that we can patch the contents
      // of activeAllocations with new allocations as they are made. This is important so that each
      // iteration gets an up to date copy of activeAllocations
      for (let i = 0; i <= activeAllocations.length - 1; i++) {
        const oldAllocation = activeAllocations[i]
        if (allocationInList(expiredAllocations, oldAllocation)) {
          const { newAllocation, reallocated } = await this.reallocate(
            epochStartBlock,
            oldAllocation,
            allocationAmount,
            activeAllocations,
          )
          if (reallocated) {
            // Patch existing index with new allocation
            activeAllocations[i] = newAllocation as Allocation
          }
        }
      }
    }
  }

  private async closeAllocation(
    epochStartBlock: BlockPointer,
    allocation: Allocation,
  ): Promise<{ closed: boolean; collectingQueryFees: boolean }> {
    const poi = await this.indexer.proofOfIndexing(
      allocation.subgraphDeployment.id,
      epochStartBlock,
      this.indexer.indexerAddress,
    )

    // Don't proceed if the POI is 0x0 or null
    if (
      poi === undefined ||
      poi === null ||
      poi === utils.hexlify(Array(32).fill(0))
    ) {
      this.logger.error(`Received a null or zero POI for deployment`, {
        deployment: allocation.subgraphDeployment.id.display,
        allocation: allocation.id,
        epochStartBlock,
      })

      return { closed: false, collectingQueryFees: false }
    }

    // Close the allocation
    const closed = await this.network.close(allocation, poi)

    // Collect query fees for this allocation
    const collectingQueryFees = await this.receiptCollector.collectReceipts(
      allocation,
    )

    return { closed, collectingQueryFees }
  }

  private async reallocate(
    epochStartBlock: BlockPointer,
    existingAllocation: Allocation,
    allocationAmount: BigNumber,
    activeAllocations: Allocation[],
  ): Promise<{
    reallocated: boolean
    collectingQueryFees: boolean
    newAllocation: Allocation | undefined
  }> {
    const poi = await this.indexer.proofOfIndexing(
      existingAllocation.subgraphDeployment.id,
      epochStartBlock,
      this.indexer.indexerAddress,
    )

    // Don't proceed if the POI is 0x0 or null
    if (
      poi === undefined ||
      poi === null ||
      poi === utils.hexlify(Array(32).fill(0))
    ) {
      this.logger.error(`Received a null or zero POI for deployment`, {
        deployment: existingAllocation.subgraphDeployment.id.display,
        allocation: existingAllocation.id,
        epochStartBlock,
      })

      return {
        reallocated: false,
        collectingQueryFees: false,
        newAllocation: undefined,
      }
    }

    // closeAndAllocate for the deployment
    const newAllocation = await this.network.closeAndAllocate(
      existingAllocation,
      poi,
      existingAllocation.subgraphDeployment.id,
      allocationAmount,
      activeAllocations,
    )

    // Collect query fees for the old allocation
    const collectingQueryFees = await this.receiptCollector.collectReceipts(
      existingAllocation,
    )

    return {
      reallocated: newAllocation !== undefined,
      collectingQueryFees,
      newAllocation,
    }
  }
}

export const startAgent = async (config: AgentConfig): Promise<Agent> => {
  const agent = new Agent(
    config.logger,
    config.metrics,
    config.indexer,
    config.network,
    config.networkSubgraph,
    config.registerIndexer,
    config.offchainSubgraphs,
    config.receiptCollector,
  )
  return await agent.start()
}
