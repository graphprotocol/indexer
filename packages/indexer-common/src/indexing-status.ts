import fetch from 'isomorphic-fetch'
import { Client, createClient } from '@urql/core'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { IndexingStatus } from './types'
import { indexerError, IndexerErrorCode } from './errors'

export interface IndexingStatusFetcherOptions {
  logger: Logger
  statusEndpoint: string
}

export class IndexingStatusResolver {
  logger: Logger
  statuses: Client

  constructor(options: IndexingStatusFetcherOptions) {
    this.logger = options.logger.child({ component: 'IndexingStatusFetcher' })
    this.statuses = createClient({
      url: options.statusEndpoint,
      fetch,
      requestPolicy: 'network-only',
    })
  }

  public async indexingStatus(
    deployments: SubgraphDeploymentID[],
  ): Promise<IndexingStatus[]> {
    const indexingStatusesQueryBody = `
      subgraphDeployment: subgraph
      synced
      health
      fatalError {
        handler
        message
      }
      node
      chains {
        network
        ... on EthereumIndexingStatus {
          latestBlock {
            number
            hash
          }
          chainHeadBlock {
            number
            hash
          }
          earliestBlock {
            number
            hash
          }
        }
      }`
    const query =
      deployments.length > 0
        ? `query indexingStatus($deployments: [String!]!) {
            indexingStatuses(subgraphs: $deployments) {
              ${indexingStatusesQueryBody}
            }
          }`
        : `query indexingStatus {
            indexingStatuses {
              ${indexingStatusesQueryBody}
            }
          }`

    try {
      const result = await this.statuses
        .query(query, { deployments: deployments.map((id) => id.ipfsHash) })
        .toPromise()
      return (
        result.data.indexingStatuses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((status: any) => ({
            ...status,
            subgraphDeployment: new SubgraphDeploymentID(status.subgraphDeployment),
          }))
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, {
        err,
      })
      throw err
    }
  }
}
