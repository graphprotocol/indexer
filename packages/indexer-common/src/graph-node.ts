import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Client, createClient } from '@urql/core'
import {
  INDEXER_ERROR_MESSAGES,
  IndexerError,
  indexerError,
  IndexerErrorCode,
} from './errors'
import { BlockPointer, ChainIndexingStatus, IndexingStatus } from './types'
import pRetry, { Options } from 'p-retry'
import axios, { AxiosInstance } from 'axios'
import fetch from 'isomorphic-fetch'

interface indexNode {
  id: string
  deployments: string[]
}

export interface SubgraphDeploymentAssignment {
  id: SubgraphDeploymentID
  node: string
}

export interface IndexingStatusFetcherOptions {
  logger: Logger
  statusEndpoint: string
}

export interface SubgraphFeatures {
  // `null` is only expected when Graph Node detects validation errors in the Subgraph Manifest.
  network: string | null
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
  earliestBlock: parseGraphQLBlockPointer(chain.earliestBlock),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLBlockPointer = (block: any): BlockPointer | null =>
  block
    ? {
        number: +block.number,
        hash: block.hash,
      }
    : null

export class GraphNode {
  admin: RpcClient
  private queryBaseURL: URL
  status: Client
  logger: Logger
  indexNodeIDs: string[]

  constructor(
    logger: Logger,
    adminEndpoint: string,
    queryEndpoint: string,
    statusEndpoint: string,
    indexNodeIDs: string[],
  ) {
    this.logger = logger.child({ component: 'GraphNode' })
    this.status = createClient({
      url: statusEndpoint,
      fetch,
      requestPolicy: 'network-only',
    })

    if (adminEndpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.admin = jayson.Client.https(adminEndpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.admin = jayson.Client.http(adminEndpoint as any)
    }

    this.queryBaseURL = new URL(`/subgraphs/id/`, queryEndpoint)

    this.indexNodeIDs = indexNodeIDs
  }

  async connect(): Promise<void> {
    try {
      this.logger.info(`Check if indexing status API is available`)
      await pRetry(
        async () => {
          const deployments = await this.subgraphDeployments()
          this.logger.info(`Successfully connected to indexing status API`, {
            currentDeployments: deployments.map((deployment) => deployment.display),
          })
        },
        {
          retries: 10,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Indexing statuses could not be queried`, {
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE024, error)
      this.logger.error(`Failed to connect to indexing status API`, {
        err,
      })
      throw err
    }
  }

  // AxiosClient factory scoped by subgraph IFPS hash
  getQueryClient(deploymentIpfsHash: string): AxiosInstance {
    return axios.create({
      baseURL: new URL(deploymentIpfsHash, this.queryBaseURL).toString(),
      headers: { 'content-type': 'application/json' },
      responseType: 'text', // Don't parse responses as JSON
      transformResponse: (data) => data, // Don't transform responses
    })
  }

  public async subgraphDeployments(): Promise<SubgraphDeploymentID[]> {
    return (await this.subgraphDeploymentsAssignments()).map((details) => details.id)
  }

  public async subgraphDeploymentsAssignments(): Promise<SubgraphDeploymentAssignment[]> {
    try {
      this.logger.debug('Fetch subgraph deployment assignments')
      const result = await this.status
        .query(gql`
          {
            indexingStatuses {
              subgraphDeployment: subgraph
              node
            }
          }
        `)
        .toPromise()

      if (result.error) {
        throw result.error
      }

      if (!result.data.indexingStatuses || result.data.length === 0) {
        this.logger.warn(`No 'indexingStatuses' data returned from index nodes`, {
          data: result.data,
        })
        return []
      }

      type QueryResult = { subgraphDeployment: string; node: string }

      return result.data.indexingStatuses
        .filter((status: QueryResult) => status.node && status.node !== 'removed')
        .map((status: QueryResult) => {
          return {
            id: new SubgraphDeploymentID(status.subgraphDeployment),
            node: status.node,
          }
        })
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, { err })
      throw err
    }
  }

  async indexNodes(): Promise<indexNode[]> {
    try {
      this.logger.trace(`Querying indexing statuses`)
      const result = await this.status
        .query(gql`
          {
            indexingStatuses {
              subgraphDeployment: subgraph
              node
            }
          }
        `)
        .toPromise()

      if (result.error) {
        throw result.error
      }

      this.logger.trace(`Queried indexing statuses`, {
        data: result.data,
      })

      if (!result.data.indexingStatuses) {
        throw new Error(
          "Received invalid results when querying indexing statuses: Response is missing a value for the 'indexingStatus' field",
        )
      }

      const indexNodes: indexNode[] = []
      result.data.indexingStatuses.map(
        (status: { subgraphDeployment: string; node: string }) => {
          const node = indexNodes.find((node) => node.id === status.node)
          node
            ? node.deployments.push(status.subgraphDeployment)
            : indexNodes.push({
                id: status.node,
                deployments: [status.subgraphDeployment],
              })
        },
      )

      this.logger.trace(`Queried index nodes`, {
        indexNodes,
      })
      return indexNodes
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query index nodes API (Should get a different IE?)`, {
        err,
      })
      throw err
    }
  }

  // --------------------------------------------------------------------------------
  // * Subgraph Management
  // --------------------------------------------------------------------------------

  async create(name: string): Promise<void> {
    try {
      this.logger.info(`Create subgraph name`, { name })
      const response = await this.admin.request('subgraph_create', { name })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully created subgraph name`, { name })
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.debug(`Subgraph name already exists, will deploy to existing name`, {
          name,
        })
        return
      }
      throw error
    }
  }

  async deploy(
    name: string,
    deployment: SubgraphDeploymentID,
    node_id: string,
  ): Promise<void> {
    try {
      this.logger.info(`Deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
        node_id,
      })
      const response = await this.admin.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
        node_id: node_id,
      })

      this.logger.trace(`Response from 'subgraph_deploy' call`, {
        deployment: deployment.display,
        name,
        node_id,
        response,
      })

      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully deployed subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
    } catch (error) {
      // If more specific error not found use the generic 'Failed to deploy' error code
      let errorCode = IndexerErrorCode.IE026

      if (error.message && error.message.includes('network not supported')) {
        errorCode = IndexerErrorCode.IE074
      }

      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        name,
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async remove(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Remove subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_reassign', {
        node_id: 'removed',
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully removed subgraph deployment`, {
        deployment: deployment.display,
      })
    } catch (error) {
      const errorCode = IndexerErrorCode.IE027
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        deployment: deployment.display,
        error: indexerError(errorCode, error),
      })
    }
  }

  async reassign(deployment: SubgraphDeploymentID, node: string): Promise<void> {
    try {
      this.logger.info(`Reassign subgraph deployment`, {
        deployment: deployment.display,
        node,
      })
      const response = await this.admin.request('subgraph_reassign', {
        node_id: node,
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.debug(`Subgraph deployment assignment unchanged`, {
          deployment: deployment.display,
          node,
        })
        return
      }
      const errorCode = IndexerErrorCode.IE028
      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async ensure(name: string, deployment: SubgraphDeploymentID): Promise<void> {
    try {
      // Randomly assign to unused nodes if they exist,
      // otherwise use the node with lowest deployments assigned
      const indexNodes = (await this.indexNodes()).filter(
        (node: { id: string; deployments: Array<string> }) => {
          return node.id && node.id !== 'removed'
        },
      )
      const usedIndexNodeIDs = indexNodes.map((node) => node.id)
      const unusedNodes = this.indexNodeIDs.filter(
        (nodeID) => !(nodeID in usedIndexNodeIDs),
      )

      const targetNode = unusedNodes
        ? unusedNodes[Math.floor(Math.random() * unusedNodes.length)]
        : indexNodes.sort((nodeA, nodeB) => {
            return nodeA.deployments.length - nodeB.deployments.length
          })[0].id
      await this.create(name)
      await this.deploy(name, deployment, targetNode)
      await this.reassign(deployment, targetNode)
    } catch (error) {
      if (!(error instanceof IndexerError)) {
        const errorCode = IndexerErrorCode.IE020
        this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
          name,
          deployment: deployment.display,
          error: indexerError(errorCode, error),
        })
      }
    }
  }

  // --------------------------------------------------------------------------------
  // * Indexing Status
  // --------------------------------------------------------------------------------
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

    const queryIndexingStatuses = async () => {
      const result = await this.status
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
    }

    try {
      return await pRetry(queryIndexingStatuses, {
        retries: 5,
        maxTimeout: 10000,
        onFailedAttempt: (err) => {
          this.logger.warn(`Indexing statuses could not be queried`, {
            attempt: err.attemptNumber,
            retriesLeft: err.retriesLeft,
            deployments,
            err: err.message,
          })
        },
      } as Options)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, {
        deployments,
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
          const result = await this.status
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
        } as Options,
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

  public async blockHashFromNumber(
    networkAlias: string,
    blockNumber: number,
  ): Promise<string> {
    this.logger.trace(`Querying blockHashFromNumber`, { networkAlias, blockNumber })
    try {
      return await pRetry(
        async (attempt) => {
          const result = await this.status
            .query(
              gql`
                query blockHashFromNumber($network: String!, $blockNumber: Int!) {
                  blockHashFromNumber(network: $network, blockNumber: $blockNumber)
                }
              `,
              {
                network: networkAlias,
                blockNumber,
              },
            )
            .toPromise()

          if (!result.data || !result.data.blockHashFromNumber || result.error) {
            throw new Error(
              `Failed to query graph node for blockHashFromNumber: ${
                result.error ?? 'no data returned'
              }`,
            )
          }

          this.logger.trace('Resolved block hash', {
            networkAlias,
            blockNumber,
            blockHash: result.data.blockHashFromNumber,
            attempt,
          })

          return `0x${result.data.blockHashFromNumber}`
        },
        {
          retries: 5,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Block hash could not be queried`, {
              networkAlias,
              blockNumber,
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE070, error)
      this.logger.error(`Failed to query block hash`, {
        networkAlias,
        blockNumber,
        error: error.message,
      })
      throw err
    }
  }

  public async subgraphFeatures(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<SubgraphFeatures> {
    const subgraphId = subgraphDeploymentId.ipfsHash
    try {
      const result = await this.status
        .query(
          gql`
            query subgraphFeatures($subgraphId: String!) {
              subgraphFeatures(subgraphId: $subgraphId) {
                network
              }
            }
          `,
          { subgraphId },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }
      if (!result.data) {
        throw new Error('Subgraph Deployment Not Found')
      }
      return result.data.subgraphFeatures as SubgraphFeatures
    } catch (error) {
      const errorCode = IndexerErrorCode.IE073
      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], { err, subgraphId })
      throw err
    }
  }
}
