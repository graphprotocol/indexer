import {
  Logger,
  IndexingRuleAttributes,
  INDEXING_RULE_GLOBAL,
  SubgraphDeploymentID,
  parseGRT,
} from '@graphprotocol/common-ts'
import { dedupeWith, groupBy, repeat } from '@thi.ng/iterators'
import { AgentConfig, Allocation } from './types'
import { Indexer } from './indexer'
import { Network } from './network'
import { BigNumber } from 'ethers'
import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'

const delay = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const deploymentInList = (
  list: SubgraphDeploymentID[],
  deployment: SubgraphDeploymentID,
): boolean =>
  list.find(item => item.bytes32 === deployment.bytes32) !== undefined

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
  networkSubgraphDeployment: SubgraphDeploymentID

  constructor(
    logger: Logger,
    indexer: Indexer,
    network: Network,
    networkSubgraphDeployment: SubgraphDeploymentID,
  ) {
    this.logger = logger
    this.indexer = indexer
    this.network = network
    this.networkSubgraphDeployment = networkSubgraphDeployment
  }

  async start(): Promise<void> {
    this.logger.info(`Connect to graph node(s)`)
    await this.indexer.connect()

    this.logger.info(`Register indexer and stake on the network`)
    await this.network.register()
    await this.network.ensureMinimumStake(parseGRT('1000'))
    this.logger.info(`Indexer active and registered on network`)

    // Ensure there is a 'global' indexer rule
    await this.indexer.ensureGlobalIndexingRule()

    // Make sure the network subgraph is being indexed
    await this.indexer.ensure(
      `${this.networkSubgraphDeployment.ipfsHash.slice(
        0,
        23,
      )}/${this.networkSubgraphDeployment.ipfsHash.slice(23)}`,
      this.networkSubgraphDeployment,
    )

    // Wait until the network subgraph is synced
    await loop(async () => {
      this.logger.info(`Waiting for network subgraph deployment to be synced`)

      // Check the network subgraph status
      const status = await this.indexer.indexingStatus(
        this.networkSubgraphDeployment,
      )

      // Throw if the subgraph has failed
      if (status.health !== 'healthy') {
        throw new Error(
          `Failed to index network subgraph deployment '${this.networkSubgraphDeployment}': ${status.fatalError.message}`,
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
        const rules = await this.indexer.indexerRules(true)

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

        // Ensure the network subgraph deployment is _always_ indexed and considered for allocations (depending on rules)
        if (
          !deploymentInList(targetDeployments, this.networkSubgraphDeployment)
        ) {
          targetDeployments.push(this.networkSubgraphDeployment)
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
          Math.max(1, maxAllocationEpochs - 1),
        )
      } catch (error) {
        this.logger.warn(`Synchronization loop failed:`, {
          error: error.message,
        })
      }

      return true
    }, 5000)
  }

  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
  ): Promise<void> {
    const uniqueDeploymentsOnly = (
      value: SubgraphDeploymentID,
      index: number,
      array: SubgraphDeploymentID[],
    ): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

    activeDeployments = activeDeployments.filter(uniqueDeploymentsOnly)
    targetDeployments = activeDeployments.filter(uniqueDeploymentsOnly)

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
    desiredStaggerEpochs: number,
  ): Promise<void> {
    const allocationLifetime = Math.max(1, maxAllocationEpochs - 1)

    // Bounding
    const staggerEpochs = Math.max(
      0,
      Math.min(desiredStaggerEpochs, allocationLifetime - 1),
    )

    this.logger.info(`Reconcile allocations`, {
      currentEpoch,
      maxAllocationEpochs,
      allocationLifetime,
      desiredStaggerEpochs,
      effectiveStaggerEpochs: staggerEpochs,
      active: activeAllocations.map(allocation => ({
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })),
    })

    // Calculate the union of active deployments and target deployments
    const deployments = [
      ...dedupeWith((a, b) => a.bytes32 === b.bytes32, [
        ...targetDeployments.map(deployment => deployment),
        ...activeAllocations.map(
          allocation => allocation.subgraphDeployment.id,
        ),
      ]),
    ]

    // Group allocations by deployment
    const allocationsByDeployment = groupBy(
      allocation => allocation.subgraphDeployment.id.bytes32,
      activeAllocations,
    )

    await pMap(
      deployments,
      async deployment => {
        const allocations = allocationsByDeployment[deployment.bytes32]

        // Identify all allocations that have reached the end of their lifetime
        let expiredAllocations = allocations.filter(
          allocation =>
            allocation.createdAtEpoch + allocationLifetime >= currentEpoch,
        )

        // The network subgraph may be behind and reporting outdated allocation
        // data; don't settle allocations that are already settled on chain
        expiredAllocations = await pFilter(
          expiredAllocations,
          async allocation => {
            try {
              this.logger.trace(
                `Cross-checking allocation state with contracts`,
                {
                  allocation: allocation.id,
                },
              )
              const onChainAllocation = await this.network.contracts.staking.getAllocation(
                allocation.id,
              )
              return onChainAllocation.settledAtEpoch !== BigNumber.from('0')
            } catch (error) {
              this.logger.warn(
                `Failed to cross-check allocation state with contracts; assuming it needs to be settled`,
                {
                  allocation: allocation.id,
                  error: error.message,
                },
              )
              return true
            }
          },
        )

        this.logger.info(`Settle expired allocations`, {
          allocations: expiredAllocations.map(allocation => allocation.id),
        })

        // Settle expired allocations
        const settledAllocations = await pFilter(
          expiredAllocations,
          async allocation => await this.network.settle(allocation),
          {
            concurrency: 1,
          },
        )

        // Check if the deployment is worth indexing it all; if not, then
        // we don't need to create any new allocations; we'll fade out our
        // allocation capacity
        if (!deploymentInList(targetDeployments, deployment)) {
          this.logger.debug(
            `Subgraph deployment is no longer worth indexing; fade out capacity by not creating new allocations`,
            {
              deployment: deployment.display,
            },
          )
          return
        }

        const maxCreatedAtEpoch = allocations.reduce(
          (max, allocation) => Math.max(max, allocation.createdAtEpoch, 0),
          0,
        )

        // Check if we should create any new allocations; if the check
        // below is true, then we still have some time until the staggered
        // allocations should be created
        if (maxCreatedAtEpoch + staggerEpochs > currentEpoch) {
          this.logger.debug(
            `Subgraph deployment requires no new (staggered) allocaitons yet`,
            {
              deployment: deployment.display,
              maxCreatedAtEpoch,
              staggerEpochs,
              currentEpoch,
            },
          )
          return
        }

        // Check if we have an indexingRule for the deployment
        const rule =
          rules.find(rule => rule.deployment === deployment.bytes32) ||
          rules.find(rule => rule.deployment === INDEXING_RULE_GLOBAL)

        if (rule === null || rule === undefined) {
          this.logger.warn(
            `Programmer error: No index rule found for deployment, which conflicts with it being considered worth indexing`,
            { deployment: deployment.display },
          )
          return
        }

        const parallelAllocations = Math.max(1, rule.parallelAllocations || 1)

        const allocationsToCreate = Math.max(
          0,
          parallelAllocations -
            (allocations.length - settledAllocations.length),
        )

        const amountPerAllocation = (rule.allocationAmount
          ? BigNumber.from(rule.allocationAmount)
          : this.indexer.defaultAllocationAmount
        ).div(parallelAllocations)

        await pMap(
          repeat(amountPerAllocation, allocationsToCreate),
          async amount => await this.network.allocate(deployment, amount),
        )
      },
      { concurrency: 1 },
    )
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
  const network = await Network.create(
    config.logger,
    config.ethereumProvider,
    config.publicIndexerUrl,
    config.queryEndpoint,
    config.indexerGeoCoordinates,
    config.mnemonic,
    config.networkSubgraphDeployment,
  )
  const agent = new Agent(
    config.logger,
    indexer,
    network,
    config.networkSubgraphDeployment,
  )
  await agent.start()
  return agent
}
