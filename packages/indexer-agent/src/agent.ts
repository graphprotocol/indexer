import {
  Logger,
  SubgraphDeploymentID,
  parseGRT,
} from '@graphprotocol/common-ts'
import PQueue from 'p-queue'

import { AgentConfig } from './types'
import { Indexer } from './indexer'
import { Network } from './network'

const delay = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const loop = async (f: () => Promise<void>, interval: number) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await f()
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

    // Make sure the network subgraph is being indexed
    await this.indexer.ensure(
      `${this.networkSubgraphDeployment.ipfsHash.slice(
        0,
        23,
      )}/${this.networkSubgraphDeployment.ipfsHash.slice(23)}`,
      this.networkSubgraphDeployment,
    )
    await this.network.allocate(this.networkSubgraphDeployment)

    this.logger.info(`Periodically synchronizing subgraphs`)

    await loop(async () => {
      try {
        this.logger.info('Synchronizing subgraphs')

        // Identify subgraph deployments indexed locally
        const indexerDeployments = await this.indexer.subgraphDeployments()

        // Identify subgraph deployments on the network that are worth picking up;
        // these may overlap with the ones we're already indexing
        const networkSubgraphs = await this.network.subgraphDeploymentsWorthIndexing()

        // Identify subgraphs allocated to
        const allocatedDeployments = await this.network.subgraphDeploymentsAllocatedTo()

        // Ensure the network subgraph deployment _always_ keeps indexing
        networkSubgraphs.push(this.networkSubgraphDeployment)

        await this.resolve(
          networkSubgraphs,
          indexerDeployments,
          allocatedDeployments,
        )
      } catch (error) {
        this.logger.warn(`Synchronization loop failed:`, {
          error: error.message,
        })
      }
    }, 5000)
  }

  async resolve(
    networkDeployments: SubgraphDeploymentID[],
    indexerDeployments: SubgraphDeploymentID[],
    allocatedDeployments: SubgraphDeploymentID[],
  ): Promise<void> {
    this.logger.info(`Synchronization result`, {
      worthIndexing: networkDeployments.map(d => d.display),
      alreadyIndexing: indexerDeployments.map(d => d.display),
      alreadyAllocated: allocatedDeployments.map(d => d.display),
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

    // Identify deployments to allocate (or reallocate) to
    let toAllocate = networkDeployments.filter(
      networkDeployment =>
        !allocatedDeployments.find(
          allocatedDeployment =>
            allocatedDeployment.bytes32 === networkDeployment.bytes32,
        ),
    )

    const uniqueDeploymentsOnly = (
      value: SubgraphDeploymentID,
      index: number,
      array: SubgraphDeploymentID[],
    ): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

    // Ensure there are no duplicates in the deployments
    toDeploy = toDeploy.filter(uniqueDeploymentsOnly)
    toRemove = toRemove.filter(uniqueDeploymentsOnly)
    toAllocate = toAllocate.filter(uniqueDeploymentsOnly)

    this.logger.info(`Apply changes`, {
      deploy: toDeploy.map(d => d.display),
      remove: toRemove.map(d => d.display),
      allocate: toAllocate.map(d => d.display),
    })

    // Allocate to all deployments worth indexing and that we haven't
    // allocated to yet
    for (const deployment of toAllocate) {
      await this.network.allocate(deployment)
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
        // Note: we're not waiting here, as sometimes indexing a subgrah
        // will block if the IPFS files cannot be retrieved
        this.indexer.ensure(name, deployment)

        // Instead of blocking, we're simply sleeping for a bit;
        // that way we don't do too much at the same time
        await delay(2000)
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
    config.logger,
    config.indexNodeIDs,
  )
  const network = await Network.create(
    config.logger,
    config.ethereumProvider,
    config.publicIndexerUrl,
    config.queryEndpoint,
    config.indexerGeoCoordinates,
    config.mnemonic,
    config.networkSubgraphDeployment,
    config.connextNode,
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
