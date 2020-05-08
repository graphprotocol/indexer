import { logging } from '@graphprotocol/common-ts'

import { AgentConfig, SubgraphKey } from './types'
import { Indexer } from './indexer'

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
  logger: logging.Logger

  constructor(config: AgentConfig) {
    this.logger = config.logger
    this.indexer = new Indexer(
      config.adminEndpoint,
      config.statusEndpoint,
      config.logger,
    )
  }

  async start() {
    await loop(async () => {
      let indexerSubgraphs = await this.indexer.subgraphs()
      // Currently the network subgraphs list acts as a set of desired subgraph deployments
      // TODO: Fetch list of subgraphs from the Network subgraphs and use the supplied list of account and subgraph names
      //  to resolve to a "desired" list
      let networkAccounts: string[] = ['DAOism']
      let networkSubgraphs: SubgraphKey[] = [
        {
          name: 'DAOism/innerdao',
          subgraphId: 'QmXsVSmFN7b5vNNia2JPbeE7NLkVHPPgZS2cHsvfH6myuV',
        },
      ]
      let accountNetworkSubgraphs: string[] = networkSubgraphs
        .filter(({ name }) => {
          return networkAccounts.includes(name.split('/')[0])
        })
        .map(({ subgraphId }) => subgraphId)
      await this.resolve(accountNetworkSubgraphs, indexerSubgraphs)
    }, 5000)
  }

  async resolve(
    networkSubgraphVersions: string[],
    indexerSubgraphVersions: string[],
  ) {
    let toDeploy: string[] = networkSubgraphVersions.filter(
      networkSubgraph => !indexerSubgraphVersions.includes(networkSubgraph),
    )
    let toRemove: string[] = indexerSubgraphVersions.filter(
      indexerSubgraph => !networkSubgraphVersions.includes(indexerSubgraph),
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
