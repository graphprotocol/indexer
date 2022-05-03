import fetch from 'isomorphic-fetch'
import gql from 'graphql-tag'
import { Client, createClient } from '@urql/core'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BlockPointer, ChainIndexingStatus, IndexingStatus } from './types'
import { indexerError, IndexerErrorCode } from './errors'
import pRetry from 'p-retry'

export interface IndexingStatusFetcherOptions {
  logger: Logger
  statusEndpoint: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLIndexingStatus = (indexingStatus: any): IndexingStatus => ({
  subgraphDeployment: new SubgraphDeploymentID(indexingStatus.subgraphDeployment),
  synced: indexingStatus.synced,
  health: indexingStatus.health,
  fatalError: indexingStatus.fatalError,
  node: indexingStatus.node,
  chains: indexingStatus.chains.map(parseGraphQLChain),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLChain = (chain: any): ChainIndexingStatus => ({
  network: chain.network,
  latestBlock: parseGraphQLBlockPointer(chain.latestBlock),
  chainHeadBlock: parseGraphQLBlockPointer(chain.chainHeadBlock),
  earliestBlock: chain.earliestBlock
    ? parseGraphQLBlockPointer(chain.earliestBlock)
    : null,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLBlockPointer = (block: any): BlockPointer => ({
  number: +block.number,
  hash: block.hash,
})

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
        ? `query indexingStatuses($deployments: [String!]!) {
            indexingStatuses(subgraphs: $deployments) {
              ${indexingStatusesQueryBody}
            }
          }`
        : `query indexingStatuses {
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

  public async proofOfIndexing(
    deployment: SubgraphDeploymentID,
    block: BlockPointer,
    indexerAddress: string,
  ): Promise<string | undefined> {
    try {
      return await pRetry(
        async (attempt) => {
          const result = await this.statuses
            .query(
              gql`
                query proofOfIndexing(
                  $subgraph: String!
                  $blockNumber: Int!
                  $blockHash: String!
                  $indexer: String!
                ) {
                  proofOfIndexing(
                    subgraph: $subgraph
                    blockNumber: $blockNumber
                    blockHash: $blockHash
                    indexer: $indexer
                  )
                }
              `,
              {
                subgraph: deployment.ipfsHash,
                blockNumber: +block.number,
                blockHash: block.hash,
                indexer: indexerAddress,
              },
            )
            .toPromise()

          if (result.error) {
            if (
              result.error.message &&
              result.error.message.includes('DeploymentNotFound')
            ) {
              return undefined
            }
            throw result.error
          }
          this.logger.trace('Reference POI generated', {
            indexer: indexerAddress,
            subgraph: deployment.ipfsHash,
            block: block,
            proof: result.data.proofOfIndexing,
            attempt,
          })

          return result.data.proofOfIndexing
        },
        {
          retries: 5,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Proof of indexing could not be queried`, {
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as pRetry.Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE019, error)
      this.logger.error(`Failed to query proof of indexing`, {
        subgraph: deployment.ipfsHash,
        blockHash: block,
        indexer: indexerAddress,
        err: err,
      })
      return undefined
    }
  }
}
