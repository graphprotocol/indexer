import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import fetch from 'isomorphic-fetch'
import { Client, createClient } from '@urql/core'
import { BigNumber } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  IndexingRuleAttributes,
  IndexerManagementClient,
  INDEXING_RULE_GLOBAL,
} from '@graphprotocol/indexer-common'
import { IndexingStatus } from './types'

export class Indexer {
  statuses: Client
  rpc: RpcClient
  indexerManagement: IndexerManagementClient
  logger: Logger
  indexNodeIDs: string[]
  defaultAllocationAmount: BigNumber

  constructor(
    adminEndpoint: string,
    statusEndpoint: string,
    indexerManagement: IndexerManagementClient,
    logger: Logger,
    indexNodeIDs: string[],
    defaultAllocationAmount: BigNumber,
  ) {
    this.indexerManagement = indexerManagement
    this.statuses = createClient({ url: statusEndpoint, fetch })
    this.logger = logger

    if (adminEndpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.rpc = jayson.Client.https(adminEndpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.rpc = jayson.Client.http(adminEndpoint as any)
    }
    this.indexNodeIDs = indexNodeIDs
    this.defaultAllocationAmount = defaultAllocationAmount
  }

  async connect(): Promise<void> {
    try {
      this.logger.info(`Check if indexing status API is available`)
      const currentDeployments = await this.subgraphDeployments()
      this.logger.info(`Successfully connected to indexing status API`, {
        currentDeployments: currentDeployments.map(
          deployment => deployment.display,
        ),
      })
    } catch (e) {
      this.logger.error(`Failed to connect to indexing status API`)
      throw e
    }
  }

  async subgraphDeployments(): Promise<SubgraphDeploymentID[]> {
    try {
      const result = await this.statuses
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
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.indexingStatuses
        .filter((status: { subgraphDeployment: string; node: string }) => {
          return status.node !== 'removed'
        })
        .map((status: { subgraphDeployment: string; node: string }) => {
          return new SubgraphDeploymentID(status.subgraphDeployment)
        })
    } catch (error) {
      this.logger.error(`Failed to query indexing status API`)
      throw error
    }
  }

  async proofOfIndexing(
    deployment: SubgraphDeploymentID,
    block: string,
  ): Promise<string> {
    try {
      const result = await this.statuses
        .query(
          gql`
            query proofOfIndexing(
              $subgraph: String!
              $blockHash: String!
            ) {
              proofOfIndexing(
                subgraph: $subgraph
                blockHash: $blockHash
              )
            }
          `,
          {
            subgraph: deployment.ipfsHash,
            blockHash: block,
          },
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.indexingStatuses
        .filter((status: { subgraphDeployment: string; node: string }) => {
          return status.node !== 'removed'
        })
        .map((status: { subgraphDeployment: string; node: string }) => {
          return new SubgraphDeploymentID(status.subgraphDeployment)
        })
    } catch (error) {
      this.logger.error(`Failed to query indexing status API`)
      throw error
    }
  }

  async indexingRules(merged: boolean): Promise<IndexingRuleAttributes[]> {
    try {
      const result = await this.indexerManagement
        .query(
          gql`
            query indexingRules($merged: Boolean!) {
              indexingRules(merged: $merged) {
                deployment
                allocationAmount
                parallelAllocations
                maxAllocationPercentage
                minSignal
                maxSignal
                minStake
                minAverageQueryFees
                custom
                decisionBasis
              }
            }
          `,
          { merged },
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.indexingRules
    } catch (error) {
      this.logger.error(`Failed to query indexer management server`)
      throw error
    }
  }

  async ensureGlobalIndexingRule(): Promise<void> {
    try {
      const globalRule = await this.indexerManagement
        .query(
          gql`
            query indexingRule($deployment: String!) {
              indexingRule(deployment: $deployment, merged: false) {
                deployment
                allocationAmount
                decisionBasis
              }
            }
          `,
          { deployment: INDEXING_RULE_GLOBAL },
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (!globalRule.data.indexingRule) {
        this.logger.info(`Creating default "global" indexing rule`)

        const defaults = {
          deployment: INDEXING_RULE_GLOBAL,
          allocationAmount: this.defaultAllocationAmount.toString(),
          parallelAllocations: 2,
          decisionBasis: 'rules',
        }

        const defaultGlobalRule = await this.indexerManagement
          .mutation(
            gql`
              mutation setIndexingRule($rule: IndexingRuleInput!) {
                setIndexingRule(rule: $rule) {
                  deployment
                  allocationAmount
                  parallelAllocations
                  maxAllocationPercentage
                  minSignal
                  maxSignal
                  minStake
                  minAverageQueryFees
                  custom
                  decisionBasis
                }
              }
            `,
            { rule: defaults },
            { requestPolicy: 'network-only' },
          )
          .toPromise()

        if (defaultGlobalRule.error) {
          throw defaultGlobalRule.error
        }

        this.logger.info(`Created default "global" indexing rule`, {
          rule: defaultGlobalRule.data.setIndexingRule,
        })
      }
    } catch (error) {
      this.logger.error('Failed to ensure default "global" indexing rule', {
        error: error.message || error,
      })
      throw error
    }
  }

  async indexingStatus(
    deployment: SubgraphDeploymentID,
  ): Promise<IndexingStatus> {
    try {
      const result = await this.statuses
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
          { requestPolicy: 'network-only' },
        )
        .toPromise()
      return (
        result.data.indexingStatuses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((status: any) => ({
            ...status,
            subgraphDeployment: new SubgraphDeploymentID(
              status.subgraphDeployment,
            ),
          }))
          .pop()
      )
    } catch (error) {
      this.logger.error(`Failed to query indexing status API`)
      throw error
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
    } catch (e) {
      this.logger.error(`Failed to deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
      throw e
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
    } catch (e) {
      this.logger.error(`Failed to remove subgraph deployment`, {
        deployment: deployment.display,
      })
      throw e
    }
  }

  async reassign(
    deployment: SubgraphDeploymentID,
    node: string,
  ): Promise<void> {
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
      this.logger.error(`Failed to reassign subgraph deployment`, {
        deployment: deployment.display,
      })
      throw error
    }
  }

  async ensure(name: string, deployment: SubgraphDeploymentID): Promise<void> {
    try {
      // Pick a random index node to assign the deployment too; TODO: Improve
      // this to assign based on load (i.e. always pick the index node with the
      // least amount of deployments assigned)
      const targetNode = this.indexNodeIDs[
        Math.floor(Math.random() * this.indexNodeIDs.length)
      ]

      await this.create(name)
      await this.deploy(name, deployment, targetNode)
      await this.reassign(deployment, targetNode)
    } catch (error) {
      this.logger.error(`Failed to ensure subgraph deployment is indexing`, {
        name,
        deployment: deployment.display,
        error,
      })
    }
  }
}
