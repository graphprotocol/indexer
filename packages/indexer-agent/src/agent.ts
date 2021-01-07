import {
  formatGRT,
  join,
  Logger,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationStatus,
  INDEXING_RULE_GLOBAL,
  IndexingRuleAttributes,
  indexerError,
  IndexerErrorCode,
} from '@graphprotocol/indexer-common'
import * as ti from '@thi.ng/iterators'
import { AgentConfig, EthereumBlock } from './types'
import { Indexer } from './indexer'
import { Network } from './network'
import { BigNumber, utils } from 'ethers'
import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'
import { Client } from '@urql/core'

const delay = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

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

const loop = async (f: () => Promise<boolean>, interval: number) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!(await f())) {
      break
    }
    await delay(interval)
  }
}

class Agent {
  indexer: Indexer
  network: Network
  logger: Logger
  networkSubgraph: Client | SubgraphDeploymentID
  registerIndexer: boolean

  constructor(
    logger: Logger,
    indexer: Indexer,
    network: Network,
    networkSubgraph: Client | SubgraphDeploymentID,
    registerIndexer: boolean,
  ) {
    this.logger = logger
    this.indexer = indexer
    this.network = network
    this.networkSubgraph = networkSubgraph
    this.registerIndexer = registerIndexer
  }

  async start(): Promise<void> {
    this.logger.info(`Connect to Graph node(s)`)
    await this.indexer.connect()

    // Ensure there is a 'global' indexing rule
    await this.indexer.ensureGlobalIndexingRule()

    // Make sure the network subgraph is being indexed
    if (this.networkSubgraph instanceof SubgraphDeploymentID) {
      await this.indexer.ensure(
        `${this.networkSubgraph.ipfsHash.slice(
          0,
          23,
        )}/${this.networkSubgraph.ipfsHash.slice(23)}`,
        this.networkSubgraph,
      )
    }

    // If we are indexing the network subgraph ourselves, wait until it is synced
    if (this.networkSubgraph instanceof SubgraphDeploymentID) {
      await loop(async () => {
        this.logger.info(`Waiting for network subgraph deployment to be synced`)

        // Check the network subgraph status
        const status = await this.indexer.indexingStatus(
          this.networkSubgraph as SubgraphDeploymentID,
        )

        // Throw if the subgraph has failed
        if (status.health !== 'healthy') {
          throw indexerError(
            IndexerErrorCode.IE003,
            new Error(
              `Failed to index network subgraph deployment '${this.networkSubgraph}': ${status.fatalError.message}`,
            ),
          )
        }

        if (status.synced) {
          // The deployment has synced, we're ready to go
          return false
        } else {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const latestBlock = status.chains[0]!.latestBlock.number
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const chainHeadBlock = status.chains[0]!.chainHeadBlock.number
          const syncedPercent = (
            (100 * (latestBlock * 1.0)) /
            chainHeadBlock
          ).toFixed(2)
          this.logger.info(
            `Network subgraph is synced ${syncedPercent}% (block #${latestBlock} of #${chainHeadBlock})`,
          )
          // The subgraph has not synced yet, keep waiting
          return true
        }
      }, 5000)

      this.logger.info(`Network subgraph deployment is synced`)
    }

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
        const startBlockNumber = await this.network.contracts.epochManager.currentEpochBlock()
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
    }).pipe(
      async ({
        paused,
        isOperator,
        currentEpoch,
        currentEpochStartBlock,
        maxAllocationEpochs,
        indexingRules,
        activeAllocations,
        claimableAllocations,
        activeDeployments,
        targetDeployments,
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
          await this.reconcileDeployments(activeDeployments, targetDeployments)

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
  }

  async claimRebateRewards(allocations: Allocation[]): Promise<void> {
    this.logger.info(`Claim rebate rewards`, {
      claimable: allocations.map(allocation => ({
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })),
    })
    await pMap(
      allocations,
      async allocation => {
        await this.network.claim(allocation)
      },
      { concurrency: 1 },
    )
  }

  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
  ): Promise<void> {
    activeDeployments = uniqueDeployments(activeDeployments)
    targetDeployments = uniqueDeployments(targetDeployments)

    // Ensure the network subgraph deployment is _always_ indexed
    if (this.networkSubgraph instanceof SubgraphDeploymentID) {
      if (!deploymentInList(targetDeployments, this.networkSubgraph)) {
        targetDeployments.push(this.networkSubgraph)
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
      deployment => !deploymentInList(targetDeployments, deployment),
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
    currentEpochStartBlock: EthereumBlock,
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

    // Ensure the network subgraph is never allocaated towards
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
    epochStartBlock: EthereumBlock,
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
          allocations: activeAllocations.map(allocation => allocation.id),
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
            const poi =
              (await this.indexer.proofOfIndexing(
                deployment,
                epochStartBlock,
              )) || utils.hexlify(Array(32).fill(0))

            await this.network.close(allocation, poi)
          },
          { concurrency: 1 },
        )
      }
      return
    }

    // If there are no allocations at all yet, create as many as
    // is desired and return early
    if (activeAllocations.length === 0) {
      logger.info(`No active allocations for deployment, creating some now`, {
        desiredNumberOfAllocations,
        allocationAmount: formatGRT(allocationAmount),
      })
      await this.network.allocateMultiple(
        deployment,
        allocationAmount,
        activeAllocations,
        desiredNumberOfAllocations,
      )

      return
    }

    const lifetime = Math.max(1, maxAllocationEpochs - 1)

    // Close expired allocations
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
          const onChainAllocation = await this.network.contracts.staking.getAllocation(
            allocation.id,
          )
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
      logger.info(`Settling expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map(allocation => allocation.id),
      })

      activeAllocations = await pFilter(
        activeAllocations,
        async (allocation: Allocation) => {
          if (allocationInList(expiredAllocations, allocation)) {
            const poi =
              (await this.indexer.proofOfIndexing(
                deployment,
                epochStartBlock,
              )) || utils.hexlify(Array(32).fill(0))
            const closed = await this.network.close(allocation, poi)
            return !closed
          } else {
            return true
          }
        },
        { concurrency: 1 },
      )
    }

    const halftime = Math.ceil((lifetime * 1.0) / 2)

    if (
      !ti.some(
        (allocation: Allocation) => allocation.createdAtEpoch === epoch,
        activeAllocations,
      )
    ) {
      // Identify half-expired allocations
      let halfExpired = activeAllocations.filter(
        allocation => epoch >= allocation.createdAtEpoch + halftime,
      )

      // Sort half-expired allocations so that those with earlier
      // creation epochs come first
      halfExpired.sort((a, b) => a.createdAtEpoch - b.createdAtEpoch)

      // Close the first half of the half-expired allocations;
      // Never close more than half of the active allocations though!
      halfExpired = [
        ...ti.take(
          Math.min(
            // Close half of the half-expired allocations,
            // leaving about 50% of the existing allocations active;
            // could be less, hence the second value below
            Math.ceil((halfExpired.length * 1.0) / 2),

            // Guarantee that we're never settling more than 50% of the existing
            // allocations
            Math.floor(activeAllocations.length / 2),
          ),
          halfExpired,
        ),
      ]
      if (halfExpired.length > 0) {
        logger.info(
          `Close half-expired allocations to allow creating new ones early and avoid gaps`,
          {
            number: halfExpired.length,
            allocations: halfExpired.map(allocation => allocation.id),
          },
        )

        activeAllocations = await pFilter(
          activeAllocations,
          async (allocation: Allocation) => {
            if (allocationInList(halfExpired, allocation)) {
              const poi =
                (await this.indexer.proofOfIndexing(
                  deployment,
                  epochStartBlock,
                )) || utils.hexlify(Array(32).fill(0))
              const closed = await this.network.close(allocation, poi)
              return !closed
            } else {
              return true
            }
          },
          { concurrency: 1 },
        )
      }
    }

    // We're now left with all still active allocations; however, these
    // may be fewer than the desired parallel allocations; create the
    // ones we're still missing
    const allocationsToCreate =
      desiredNumberOfAllocations - activeAllocations.length
    if (allocationsToCreate > 0) {
      logger.info(
        `Create allocations to maintain desired parallel allocations`,
        {
          desiredNumberOfAllocations,
          activeAllocations: activeAllocations.length,
          allocationsToCreate:
            desiredNumberOfAllocations - activeAllocations.length,
          allocationAmount: formatGRT(allocationAmount),
        },
      )

      await this.network.allocateMultiple(
        deployment,
        allocationAmount,
        activeAllocations,
        allocationsToCreate,
      )
    }
  }
}

export const startAgent = async (config: AgentConfig): Promise<Agent> => {
  const indexer = new Indexer(
    config.adminEndpoint,
    config.statusEndpoint,
    config.indexerManagement,
    config.logger,
    config.indexNodeIDs,
    config.defaultAllocationAmount,
    config.network.indexerAddress,
  )

  const agent = new Agent(
    config.logger,
    indexer,
    config.network,
    config.networkSubgraph,
    config.registerIndexer,
  )
  await agent.start()
  return agent
}
