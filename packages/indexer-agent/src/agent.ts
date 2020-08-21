import {
  Logger,
  IndexingRuleAttributes,
  INDEXING_RULE_GLOBAL,
  SubgraphDeploymentID,
  parseGRT,
} from '@graphprotocol/common-ts'
import PQueue from 'p-queue'

import { AgentConfig, Allocation } from './types'
import { Indexer } from './indexer'
import { Network } from './network'
import { BigNumber } from 'ethers'
import pFilter from 'p-filter'

const MINIMUM_STAKE = parseGRT('10000000')
const MINIMUM_SIGNAL = parseGRT('10000000')

const delay = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

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
        const maxEpochsPerAllocation = await this.network.contracts.staking.maxAllocationEpochs()

        // Identify subgraph deployments indexed locally
        const indexerDeployments = await this.indexer.subgraphDeployments()

        // Fetch all indexing rules
        const rules = await this.indexer.indexerRules(true)

        if (rules.length === 0) {
          this.logger.warn(
            'No indexing rules defined yet. Use the `graph indexer` CLI to add rules',
          )
        }

        // Identify subgraph deployments on the network that are worth picking up;
        // these may overlap with the ones we're already indexing
        const networkSubgraphs =
          rules.length === 0
            ? []
            : await this.network.subgraphDeploymentsWorthIndexing(rules)

        // Identify active allocations
        const allocations = await this.network.activeAllocations()

        await this.resolve(
          epoch,
          maxEpochsPerAllocation,
          networkSubgraphs,
          indexerDeployments,
          allocations,
          rules,
        )
      } catch (error) {
        this.logger.warn(`Synchronization loop failed:`, {
          error: error.message,
        })
      }

      return true
    }, 5000)
  }

  async resolve(
    epoch: number,
    maxEpochsPerAllocation: number,
    networkDeployments: SubgraphDeploymentID[],
    indexerDeployments: SubgraphDeploymentID[],
    allocations: Allocation[],
    rules: IndexingRuleAttributes[],
  ): Promise<void> {
    this.logger.info(`Synchronization result`, {
      epoch,
      maxEpochsPerAllocation,
      worthIndexing: networkDeployments.map(d => d.display),
      alreadyIndexing: indexerDeployments.map(d => d.display),
      alreadyAllocated: allocations.map(a => ({
        id: a.id,
        deployment: a.subgraphDeployment.id.display,
        createdAtEpoch: a.createdAtEpoch,
      })),
    })

    // Identify which subgraphs to deploy and which to remove
    let toDeploy = networkDeployments.filter(
      networkDeployment =>
        !indexerDeployments.find(
          indexerDeployment =>
            networkDeployment.bytes32 === indexerDeployment.bytes32,
        ),
    )
    let toRemove = indexerDeployments.filter(
      indexerDeployment =>
        !networkDeployments.find(
          networkDeployment =>
            indexerDeployment.bytes32 === networkDeployment.bytes32,
        ),
    )

    // Ensure the network subgraph deployment _always_ keeps indexing
    toRemove = toRemove.filter(
      deployment =>
        deployment.bytes32 !== this.networkSubgraphDeployment.bytes32,
    )
    if (
      !indexerDeployments.find(
        indexerDeployment =>
          indexerDeployment.bytes32 === this.networkSubgraphDeployment.bytes32,
      )
    ) {
      toDeploy.push(this.networkSubgraphDeployment)
    }

    const settleAllocationsBeforeEpoch =
      epoch - Math.max(1, maxEpochsPerAllocation) + 1

    this.logger.info(`Settle all allocations before epoch`, {
      epoch: settleAllocationsBeforeEpoch,
    })

    // Identify allocations to settle
    let toSettle = allocations.filter(
      allocation =>
        // Either the allocation is old (approaching the max allocation epochs)
        allocation.createdAtEpoch < settleAllocationsBeforeEpoch ||
        // ...or the deployment isn't worth it anymore
        (allocation.subgraphDeployment.signalAmount.lt(MINIMUM_SIGNAL) &&
          allocation.subgraphDeployment.stakedTokens.lt(MINIMUM_STAKE)),
    )

    // Identify deployments to allocate (or reallocate) to
    let toAllocate = networkDeployments.filter(
      networkDeployment =>
        !allocations.find(
          allocation =>
            allocation.subgraphDeployment.id.bytes32 ===
            networkDeployment.bytes32,
        ),
    )

    const uniqueDeploymentsOnly = (
      value: SubgraphDeploymentID,
      index: number,
      array: SubgraphDeploymentID[],
    ): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

    const uniqueAllocationsOnly = (
      value: Allocation,
      index: number,
      array: Allocation[],
    ): boolean => array.findIndex(v => value.id === v.id) === index

    // Ensure there are no duplicates in the deployments
    toDeploy = toDeploy.filter(uniqueDeploymentsOnly)
    toRemove = toRemove.filter(uniqueDeploymentsOnly)
    toAllocate = toAllocate.filter(uniqueDeploymentsOnly)
    toSettle = toSettle.filter(uniqueAllocationsOnly)

    // The network subgraph may be behind and reporting outdated allocation
    // data; don't settle allocations that are already settled on chain
    toSettle = await pFilter(toSettle, async allocation => {
      try {
        this.logger.trace(`Cross-checking allocation state with contracts`, {
          allocation: allocation.id,
        })
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
    })

    this.logger.info(`Apply changes`, {
      deploy: toDeploy.map(d => d.display),
      remove: toRemove.map(d => d.display),
      allocate: toAllocate.map(d => d.display),
      settle: toSettle.map(
        a => `${a.id} (deployment: ${a.subgraphDeployment.id})`,
      ),
    })

    // Settle first
    for (const allocation of toSettle) {
      await this.network.settle(allocation)
    }

    // Allocate to all deployments worth indexing and that we haven't
    // allocated to yet
    if (toAllocate.length > 0) {
      const globalRule = rules.find(
        rule => rule.deployment === INDEXING_RULE_GLOBAL,
      )
      for (const deployment of toAllocate) {
        const allocation =
          rules.find(rule => rule.deployment === deployment.bytes32)
            ?.allocationAmount || globalRule?.allocationAmount

        // It is safe to assume allocation is not null since a `global` rule is ensure to exist during `indexer-agent` startup
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.network.allocate(deployment, allocation!)
      }
    }

    // Deploy/remove up to 10 subgraphs in parallel
    const queue = new PQueue({ concurrency: 10 })

    // Index all new deployments worth indexing
    for (const deployment of toDeploy) {
      const name = `indexer-agent/${deployment.ipfsHash.slice(-10)}`

      queue.add(async () => {
        this.logger.info(`Begin indexing subgraph deployment`, {
          name,
          deployment: deployment.display,
        })

        // Ensure the deployment is deployed to the indexer
        // Note: we're not waiting here, as sometimes indexing a subgraph
        // will block if the IPFS files cannot be retrieved
        this.indexer.ensure(name, deployment)
      })
    }

    // Stop indexing deployments that are no longer worth indexing
    for (const deployment of toRemove) {
      queue.add(async () => {
        await this.indexer.remove(deployment)
      })
    }

    await queue.onIdle()
  }
}

export const startAgent = async (config: AgentConfig): Promise<Agent> => {
  const indexer = new Indexer(
    config.adminEndpoint,
    config.statusEndpoint,
    config.indexerManagement,
    config.logger,
    config.indexNodeIDs,
    config.defaultAllocation,
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
