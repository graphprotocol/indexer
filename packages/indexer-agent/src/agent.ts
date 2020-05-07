import { logging } from '@graphprotocol/common-ts'

import { AgentConfig, SubgraphKey } from './types'
import { Indexer } from './indexer'

let delay = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
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
      config.indexNode,
      config.queryNode,
      config.logger,
    )
  }

  async start() {
    await loop(async () => {
      let indexerSubgraphs = await this.indexer.subgraphs()
      // Currently the network subgraphs list acts as a set of desired subgraph deployments
      // TODO: Fetch list of subgraphs from the Network subgraphs and use the supplied list of account and subgraph names
      //  to resolve to a "desired" list
      let networkSubgraphs: SubgraphKey[] = [
        {
          name: 'DAOism/innerdao',
          contentHash: 'QmXsVSmFN7b5vNNia2JPbeE7NLkVHPPgZS2cHsvfH6myuV',
        },
      ]

      await this.resolve(networkSubgraphs, indexerSubgraphs)
    }, 5000)
  }

  async resolve(
    networkSubgraphVersions: SubgraphKey[],
    indexerSubgraphVersions: SubgraphKey[],
  ) {
    let toDeploy: SubgraphKey[] = networkSubgraphVersions.filter(
      (networkSubgraph) =>
        !indexerSubgraphVersions.some(
          (indexerSubgraph) =>
            indexerSubgraph.contentHash == networkSubgraph.contentHash,
        ),
    )
    let toRemove: SubgraphKey[] = indexerSubgraphVersions.filter(
      (indexerSubgraph) =>
        !networkSubgraphVersions.some(
          (networkSubgraph) =>
            networkSubgraph.contentHash == indexerSubgraph.contentHash,
        ),
    )

    if (toDeploy.length > 0) {
      this.logger.info('Subgraphs to deploy to Indexer:')
      toDeploy.forEach((subgraph) => {
        this.logger.info(`    ${subgraph.name}:${subgraph.contentHash}`)
        // TODO: Deploy subgraph to Indexer
      })
    }

    if (toRemove.length > 0) {
      this.logger.info('Subgraphs to remove from Indexer:')
      toRemove.forEach((subgraph) => {
        this.logger.info(`    ${subgraph.contentHash}`)
        // TODO: Remove subgraph from Indexer
      })
    }
  }
}
