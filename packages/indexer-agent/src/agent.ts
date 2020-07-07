import { logging } from '@graphprotocol/common-ts'

import { AgentConfig, SubgraphKey } from './types'
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

  constructor(config: AgentConfig) {
    this.logger = config.logger
    this.indexer = new Indexer(
      config.adminEndpoint,
      config.statusEndpoint,
      config.logger,
    )
    this.network = new Network(
      this.logger,
      config.ethereumProvider,
      config.network,
      config.publicIndexerUrl,
      config.queryEndpoint,
      config.indexerGeoCoordinates,
      config.mnemonic,
    )
  }

  async bootstrapTestNetwork() {
    this.logger.info('Indexer booted up..')
    this.logger.info('Bootstrapping the test network')

    const graphNetworkSubgraphName = 'graphprotocol/network-kovan'
    // ganache
    const graphNetworkSubgraphId_ganache =
      'QmTWRhewNXYUgrLbcvS2PBNcw7xhHTGgeAiaCXvrjECMiG'
    const graphNetworkSubgraphId =
      'QmaTgzW8yNBhbeer5zytGK1RAJcrHJUKSr9BCi3QuqV5SB'
    const graphNetworkSubgraphMetadata =
      'QmUdTzZz9bRQ4t637xjTgEWavJ49ctPDrQNxVLU2Btg4Vg'
    this.logger.info(`Publish the Network Subgraph`)
    await this.network.publish(
      graphNetworkSubgraphName,
      graphNetworkSubgraphId,
      graphNetworkSubgraphMetadata,
    )
    this.logger.info(
      `Begin indexing the network subgraph: '${graphNetworkSubgraphName}':'${graphNetworkSubgraphId}'`,
    )
    await this.indexer.ensure(graphNetworkSubgraphName, graphNetworkSubgraphId)
    await this.network.stake(graphNetworkSubgraphId)
    this.logger.info(
      `Now indexing '${graphNetworkSubgraphName}':'${graphNetworkSubgraphId}'`,
    )
    await delay(20000)
  }

  async setupIndexer() {
    await this.indexer.connect()
    await this.network.register()
    await this.network.ensureMinimumStake(100)
  }

  async start() {
    this.logger.info(`Agent booted up`)
    this.logger.info(`Polling for subgraph changes`)
    await loop(async () => {
      let bootstrapSubgraph: string = 'graphprotocol/network'
      let accountsToIndex: string[] = ['indexer-agent']

      let indexerSubgraphs = await this.indexer.subgraphs()
      let networkSubgraphs = await this.network.subgraphs()
      let subgraphsToIndex: string[] = networkSubgraphs
        .filter(subgraph => {
          return (
            accountsToIndex.includes(subgraph.owner) ||
            bootstrapSubgraph == subgraph.name
          )
        })
        .map(({ subgraphId }) => subgraphId)

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
