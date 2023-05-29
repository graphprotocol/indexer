import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  IndexerManagementClient,
  indexerError,
  IndexerErrorCode,
  IndexingStatusResolver,
  IndexingStatus,
  parseGraphQLIndexingStatus,
} from '@graphprotocol/indexer-common'

interface indexNode {
  id: string
  deployments: string[]
}

export class GraphNode {
  statusResolver: IndexingStatusResolver
  rpc: RpcClient
  indexerManagement: IndexerManagementClient
  logger: Logger
  indexNodeIDs: string[]

  constructor(
    logger: Logger,
    adminEndpoint: string,
    statusResolver: IndexingStatusResolver,
    indexerManagement: IndexerManagementClient,
    indexNodeIDs: string[],
  ) {
    this.indexerManagement = indexerManagement
    this.statusResolver = statusResolver
    this.logger = logger

    if (adminEndpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.rpc = jayson.Client.https(adminEndpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.rpc = jayson.Client.http(adminEndpoint as any)
    }
    this.indexNodeIDs = indexNodeIDs
  }

  async connect(): Promise<void> {
    try {
      this.logger.info(`Check if indexing status API is available`)
      const currentDeployments = await this.subgraphDeployments()
      this.logger.info(`Successfully connected to indexing status API`, {
        currentDeployments: currentDeployments.map((deployment) => deployment.display),
      })
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE024, error)
      this.logger.error(`Failed to connect to indexing status API`, {
        err,
      })
      throw err
    }
  }

  async subgraphDeployments(): Promise<SubgraphDeploymentID[]> {
    try {
      const result = await this.statusResolver.statuses
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.indexingStatuses
        .filter((status: { subgraphDeployment: string; node: string }) => {
          return status.node && status.node !== 'removed'
        })
        .map((status: { subgraphDeployment: string; node: string }) => {
          return new SubgraphDeploymentID(status.subgraphDeployment)
        })
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, { err })
      throw err
    }
  }

  async indexNodes(): Promise<indexNode[]> {
    try {
      const result = await this.statusResolver.statuses
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
        )
        .toPromise()

      if (result.error) {
        throw result.error
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

  async indexingStatus(deployment: SubgraphDeploymentID): Promise<IndexingStatus> {
    try {
      const result = await this.statusResolver.statuses
        .query(
          gql`
            query indexingStatus($deployments: [String!]!) {
              indexingStatuses(subgraphs: $deployments) {
                subgraphDeployment: subgraph
                synced
                health
                fatalError {
                  handler
                  message
                }
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
                  }
                }
              }
            }
          `,
          { deployments: [deployment.ipfsHash] },
        )
        .toPromise()
      this.logger.debug(`Query indexing status`, {
        deployment,
        statuses: result.data,
      })
      return (
        result.data.indexingStatuses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((status: any) => parseGraphQLIndexingStatus(status))
          .pop()
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, {
        err,
      })
      throw err
    }
  }

  async create(name: string): Promise<void> {
    try {
      this.logger.info(`Create subgraph name`, { name })
      const response = await this.rpc.request('subgraph_create', { name })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully created subgraph name`, { name })
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.debug(`Subgraph name already exists`, { name })
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
      })
      const response = await this.rpc.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
        node_id: node_id,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully deployed subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE026, error)
      this.logger.error(`Failed to deploy subgraph deployment`, {
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
      const response = await this.rpc.request('subgraph_reassign', {
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
      const err = indexerError(IndexerErrorCode.IE027, error)
      this.logger.error(`Failed to remove subgraph deployment`, {
        deployment: deployment.display,
        err,
      })
    }
  }

  async reassign(deployment: SubgraphDeploymentID, node: string): Promise<void> {
    try {
      this.logger.info(`Reassign subgraph deployment`, {
        deployment: deployment.display,
        node,
      })
      const response = await this.rpc.request('subgraph_reassign', {
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
      const err = indexerError(IndexerErrorCode.IE028, error)
      this.logger.error(`Failed to reassign subgraph deployment`, {
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
      const err = indexerError(IndexerErrorCode.IE020, error)
      this.logger.error(`Failed to ensure subgraph deployment is indexing`, {
        name,
        deployment: deployment.display,
        err,
      })
    }
  }
}
