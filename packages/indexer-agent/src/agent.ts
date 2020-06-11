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
    this.logger.info('Bootstrapping the test network')
    const subgraphs = [
      [
        'graphprotocol/network-kovan',
        'Qma3PvKVRvvMMbUwyovxaPBzDTaspuEmzVfHAcP8xoNhUX',
        'QmUdTzZz9bRQ4t637xjTgEWavJ49ctPDrQNxVLU2Btg4Vg',
      ],
    ]
    const publishPromises = subgraphs.map(
      async subgraph =>
        await this.publishSubgraph(subgraph[0], subgraph[1], subgraph[2]),
    )

    await Promise.all(publishPromises)

    await delay(100000)
  }

  async publishSubgraph(name: string, id: string, metadata: string) {
    this.logger.info(`Publish '${name}' to the network`)
    await this.network.publish(name, id, metadata)
    this.logger.info(`Begin indexing subgraph: '${name}':'${id}'`)
    await this.indexer.ensure(name, id)
    await this.network.stake(id)
    this.logger.info(`Now indexing '${name}':'${id}'`)
  }

  async setupIndexer() {
    this.logger.info(`Connecting to indexer and ensuring regisration and stake on the network`)
    await this.indexer.connect()
    await this.network.register()
    await this.network.ensureMinimumStake(100)
    this.logger.info(`Indexer active and registered on network..`)
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
