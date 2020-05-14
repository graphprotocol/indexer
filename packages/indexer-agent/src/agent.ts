import { logging } from '@graphprotocol/common-ts'
import { ethers, Wallet } from 'ethers'

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
    let wallet = Wallet.fromMnemonic(config.mnemonic)
    wallet = wallet.connect(ethers.getDefaultProvider())
    this.network = new Network(this.logger, wallet)
  }

  async start() {
    await this.network.register()

    await loop(async () => {
      let bootstrapSubgraphs: string[] = ['graphprotocol/network']
      let accountsToIndex: string[] = ['DAOism']

      let indexerSubgraphs = await this.indexer.subgraphs()
      let networkSubgraphs = await this.network.subgraphs()

      let subgraphsToIndex: string[] = networkSubgraphs
        .filter(({ name }) => {
          return (
            accountsToIndex.includes(name.split('/')[0]) ||
            bootstrapSubgraphs.includes(name)
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
        subgraphName = [subgraphName, subgraphName].join('/')
        await this.indexer.ensure(subgraphName, subgraph)
      }),
    )
    await Promise.all(
      toRemove.map(async subgraph => {
        await this.indexer.remove(subgraph)
      }),
    )
  }
}
