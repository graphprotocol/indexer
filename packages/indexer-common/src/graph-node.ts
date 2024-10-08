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
  paused: boolean
}

export interface IndexingStatusFetcherOptions {
  logger: Logger
  statusEndpoint: string
}

export interface SubgraphFeatures {
  // `null` is only expected when Graph Node detects validation errors in the Subgraph Manifest.
  network: string | null
}

export enum SubgraphStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ALL = 'all',
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

  constructor(
    logger: Logger,
    adminEndpoint: string,
    queryEndpoint: string,
    statusEndpoint: string,
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
      baseURL: this.getQueryEndpoint(deploymentIpfsHash),
      headers: { 'content-type': 'application/json' },
      responseType: 'text', // Don't parse responses as JSON
      transformResponse: (data) => data, // Don't transform responses
    })
  }

  getQueryEndpoint(deploymentIpfsHash: string): string {
    return new URL(deploymentIpfsHash, this.queryBaseURL).toString()
  }

  public async subgraphDeployments(): Promise<SubgraphDeploymentID[]> {
    return (await this.subgraphDeploymentsAssignments(SubgraphStatus.ACTIVE)).map(
      (details) => details.id,
    )
  }

  public async subgraphDeploymentsAssignments(
    subgraphStatus: SubgraphStatus,
  ): Promise<SubgraphDeploymentAssignment[]> {
    try {
      this.logger.debug('Fetch subgraph deployment assignments')
      const result = await this.status
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
                paused
              }
            }
          `,
          undefined,
        )
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

      type QueryResult = {
        subgraphDeployment: string
        node: string | undefined
        paused: boolean | undefined
      }

      return result.data.indexingStatuses
        .filter((status: QueryResult) => {
          if (subgraphStatus === SubgraphStatus.ACTIVE) {
            return (
              status.paused === false ||
              (status.paused === undefined && status.node !== 'removed')
            )
          } else if (subgraphStatus === SubgraphStatus.PAUSED) {
            return status.node === 'removed' || status.paused === true
          } else if (subgraphStatus === SubgraphStatus.ALL) {
            return true
          }
        })
        .map((status: QueryResult) => {
          return {
            id: new SubgraphDeploymentID(status.subgraphDeployment),
            node: status.node,
            paused: status.paused ?? status.node === 'removed',
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
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
          undefined,
        )
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

  async deploy(name: string, deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
      })

      this.logger.trace(`Response from 'subgraph_deploy' call`, {
        deployment: deployment.display,
        name,
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

  async pause(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Pause subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_pause', {
        deployment: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully paused subgraph deployment`, {
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

  async resume(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Resume subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_resume', {
        deployment: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully resumed subgraph deployment`, {
        deployment: deployment.display,
      })
    } catch (error) {
      const errorCode = IndexerErrorCode.IE076
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

  async ensure(
    name: string,
    deployment: SubgraphDeploymentID,
    currentAssignments?: SubgraphDeploymentAssignment[],
  ): Promise<void> {
    this.logger.debug('Ensure subgraph deployment is syncing', {
      name,
      deployment: deployment.ipfsHash,
    })
    try {
      const deploymentAssignments =
        currentAssignments ??
        (await this.subgraphDeploymentsAssignments(SubgraphStatus.ALL))
      const matchingAssignment = deploymentAssignments.find(
        (deploymentAssignment) => deploymentAssignment.id.ipfsHash == deployment.ipfsHash,
      )

      if (matchingAssignment?.paused == false) {
        this.logger.debug('Subgraph deployment already syncing, ensure() is a no-op', {
          name,
          deployment: deployment.ipfsHash,
        })
      } else if (matchingAssignment?.paused == true) {
        this.logger.debug('Subgraph deployment paused, resuming', {
          name,
          deployment: deployment.ipfsHash,
        })
        await this.resume(deployment)
      } else {
        this.logger.debug(
          'Subgraph deployment not found, creating subgraph name and deploying...',
          {
            name,
            deployment: deployment.ipfsHash,
          },
        )
        await this.create(name)
        await this.deploy(name, deployment)
      }
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
