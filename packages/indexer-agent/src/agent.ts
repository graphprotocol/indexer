import {
  Logger,
  IndexingRuleAttributes,
  INDEXING_RULE_GLOBAL,
  SubgraphDeploymentID,
  parseGRT,
  formatGRT,
} from '@graphprotocol/common-ts'
import * as ti from '@thi.ng/iterators'
import { AgentConfig, Allocation } from './types'
import { Indexer } from './indexer'
import { Network } from './network'
import { BigNumber } from 'ethers'
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

  constructor(
    logger: Logger,
    indexer: Indexer,
    network: Network,
    networkSubgraph: Client | SubgraphDeploymentID,
  ) {
    this.logger = logger
    this.indexer = indexer
    this.network = network
    this.networkSubgraph = networkSubgraph
  }

  async start(): Promise<void> {
    this.logger.info(`Connect to Graph node(s)`)
    await this.indexer.connect()

    this.logger.info(`Register indexer and stake on the network`)
    await this.network.register()
    await this.network.ensureMinimumStake(parseGRT('1000'))
    this.logger.info(`Indexer active and registered on network`)

    // Ensure there is a 'global' indexer rule
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
          throw new Error(
            `Failed to index network subgraph deployment '${this.networkSubgraph}': ${status.fatalError.message}`,
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

    this.logger.info(`Periodically synchronizing subgraphs`)

    await loop(async () => {
      try {
        this.logger.info('Synchronizing subgraphs')

        // Identify the current epoch
        const epoch = (
          await this.network.contracts.epochManager.currentEpoch()
        ).toNumber()
        const maxAllocationEpochs = await this.network.contracts.staking.maxAllocationEpochs()

        // Identify subgraph deployments indexed locally
        const activeDeployments = await this.indexer.subgraphDeployments()

        // Fetch all indexing rules
        const rules = await this.indexer.indexingRules(true)

        if (rules.length === 0) {
          this.logger.warn(
            'No indexing rules defined yet. Use the `graph indexer` CLI to add rules',
          )
        }

        // Identify subgraph deployments on the network that are worth picking up;
        // these may overlap with the ones we're already indexing
        const targetDeployments =
          rules.length === 0
            ? []
            : await this.network.subgraphDeploymentsWorthIndexing(rules)

        if (this.networkSubgraph instanceof SubgraphDeploymentID) {
          // Ensure the network subgraph deployment is _always_ indexed and
          // considered for allocations (depending on rules)
          if (!deploymentInList(targetDeployments, this.networkSubgraph)) {
            targetDeployments.push(this.networkSubgraph)
          }
        }

        // Identify active allocations
        const activeAllocations = await this.network.activeAllocations()

        // Reconcile deployments
        await this.reconcileDeployments(activeDeployments, targetDeployments)

        // Reconcile allocations
        await this.reconcileAllocations(
          activeAllocations,
          targetDeployments,
          rules,
          epoch,
          maxAllocationEpochs,
        )
      } catch (error) {
        this.logger.warn(`Synchronization loop failed:`, {
          error: error.message,
        })
      }

      return true
    }, 10000)
  }

  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
  ): Promise<void> {
    activeDeployments = uniqueDeployments(activeDeployments)
    targetDeployments = uniqueDeployments(targetDeployments)

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
    queue.addAll(
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
    queue.addAll(
      remove.map(deployment => async () => this.indexer.remove(deployment)),
    )

    await queue.onIdle()
  }

  async reconcileAllocations(
    activeAllocations: Allocation[],
    targetDeployments: SubgraphDeploymentID[],
    rules: IndexingRuleAttributes[],
    currentEpoch: number,
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
        `Deployment is not (or no longer) worth indexing, settle all allocations`,
        {
          allocations: activeAllocations.map(allocation => allocation.id),
        },
      )

      // Make sure to settle all active allocations on the way out
      if (activeAllocations.length > 0) {
        // We can only settle allocations that are at least one epoch old;
        // try the others again later
        await pMap(
          activeAllocations.filter(
            allocation => allocation.createdAtEpoch < epoch,
          ),
          async allocation => await this.network.settle(allocation),
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

      await pMap(
        ti.repeat(allocationAmount, desiredNumberOfAllocations),
        async amount => await this.network.allocate(deployment, amount),
        { concurrency: 1 },
      )

      return
    }

    const lifetime = Math.max(1, maxAllocationEpochs - 1)

    // Settle expired allocations
    let expiredAllocations = activeAllocations.filter(
      allocation => epoch >= allocation.createdAtEpoch + lifetime,
    )
    // The allocations come from the network subgraph; due to short indexing
    // latencies, this data may be slightly outdated. Cross-check with the
    // contracts to avoid settling allocations that are already settled on
    // chain.
    expiredAllocations = await pFilter(expiredAllocations, async allocation => {
      try {
        const onChainAllocation = await this.network.contracts.staking.getAllocation(
          allocation.id,
        )
        return onChainAllocation.settledAtEpoch.eq('0')
      } catch (error) {
        this.logger.warn(
          `Failed to cross-check allocation state with contracts; assuming it needs to be settled`,
          {
            deployment: deployment.display,
            allocation: allocation.id,
            error: error.message,
          },
        )
        return true
      }
    })

    if (expiredAllocations.length > 0) {
      logger.info(`Settling expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map(allocation => allocation.id),
      })

      activeAllocations = await pFilter(
        activeAllocations,
        async allocation => {
          if (allocationInList(expiredAllocations, allocation)) {
            const settled = await this.network.settle(allocation)
            return !settled
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
        allocation => allocation.createdAtEpoch === epoch,
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

      // Settle the first half of the half-expired allocations;
      // Never settle more than half of the active allocations though!
      halfExpired = [
        ...ti.take(
          Math.min(
            // Settle half of the half-expired allocations,
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
          `Settle half-expired allocations to allow creating new ones early and avoid gaps`,
          {
            number: halfExpired.length,
            allocations: halfExpired.map(allocation => allocation.id),
          },
        )

        activeAllocations = await pFilter(
          activeAllocations,
          async allocation => {
            if (allocationInList(halfExpired, allocation)) {
              const settled = await this.network.settle(allocation)
              return !settled
            } else {
              return true
            }
          },
          { concurrency: 1 },
        )
      }
    }

    // We're now left with all still active allocations; however, these
    // may be fewer than the desired parallel alloctions; create the
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
      await pMap(
        ti.repeat(allocationAmount, allocationsToCreate),
        async amount => {
          await this.network.allocate(deployment, amount)
        },
        { concurrency: 1 },
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
  )

  const agent = new Agent(
    config.logger,
    indexer,
    config.network,
    config.networkSubgraph,
  )
  await agent.start()
  return agent
}
