import { logging } from '@graphprotocol/common-ts'

import { AgentConfig } from './types'
import { Indexer } from './indexer'
import { Network } from './network'

let delay = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

let loop = async (f: () => Promise<void>, interval: number) => {
  while (true) {
    await f()
    await delay(interval)
  }
}

export class Agent {
  indexer: Indexer
  network: Network
  logger: logging.Logger
  networkSubgraphDeployment: string

  private constructor(
    logger: logging.Logger,
    indexer: Indexer,
    network: Network,
    networkSubgraphDeployment: string,
  ) {
    this.logger = logger
    this.indexer = indexer
    this.network = network
    this.networkSubgraphDeployment = networkSubgraphDeployment
  }

  static async create(config: AgentConfig): Promise<Agent> {
    let indexer = new Indexer(
      config.adminEndpoint,
      config.statusEndpoint,
      config.logger,
    )
    let network = await Network.create(
      config.logger,
      config.ethereumProvider,
      config.network,
      config.publicIndexerUrl,
      config.queryEndpoint,
      config.indexerGeoCoordinates,
      config.mnemonic,
      config.networkSubgraphDeployment,
    )
    return new Agent(
      config.logger,
      indexer,
      network,
      config.networkSubgraphDeployment,
    )
  }

  async setupIndexer() {
    this.logger.info(
      `Connecting to indexer and ensuring regisration and stake on the network`,
    )
    await this.indexer.connect()
    await this.network.register()
    await this.network.ensureMinimumStake(100)
    this.logger.info(`Indexer active and registered on network..`)
  }

  async start() {
    this.logger.info(`Agent booted up`)

    await this.indexer.ensure(
      `${this.networkSubgraphDeployment.slice(
        0,
        23,
      )}/${this.networkSubgraphDeployment.slice(23)}`,
      this.networkSubgraphDeployment,
    )
    await this.network.stake(this.networkSubgraphDeployment)

    this.logger.info(`Polling for subgraph changes`)
    await loop(async () => {
      let indexerSubgraphs = await this.indexer.subgraphs()
      let networkSubgraphs = await this.network.subgraphs()

      let subgraphsToIndex: string[] = [
        ...networkSubgraphs.map(({ subgraphId }) => subgraphId),

        // Ensure the network subgraph deployment _always_ keeps indexing
        this.networkSubgraphDeployment,
      ]

      await this.resolve(subgraphsToIndex, indexerSubgraphs)
    }, 5000)
  }

  async resolve(networkSubgraphs: string[], indexerSubgraphs: string[]) {
    let toDeploy: string[] = networkSubgraphs.filter(
      networkSubgraph => !indexerSubgraphs.includes(networkSubgraph),
    )
    let toRemove: string[] = indexerSubgraphs.filter(
      indexerSubgraph => !networkSubgraphs.includes(indexerSubgraph),
    )
    await Promise.all(
      toDeploy.map(async subgraph => {
        let subgraphName: string = subgraph.toString().slice(-10)
        subgraphName = ['indexer-agent', subgraphName].join('/')

        // Ensure the subgraph is deployed to the indexer and allocate stake on the subgraph in the network
        this.logger.info(`Begin indexing '${subgraphName}':'${subgraph}'...`)
        await this.indexer.ensure(subgraphName, subgraph)
        await this.network.stake(subgraph)
        this.logger.info(`Now indexing '${subgraphName}':'${subgraph}'`)
      }),
    )
    await Promise.all(
      toRemove.map(async subgraph => {
        await this.indexer.remove(subgraph)
      }),
    )
  }
}
