import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import { BigNumber } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  IndexingRuleAttributes,
  IndexerManagementClient,
  INDEXING_RULE_GLOBAL,
  indexerError,
  IndexerErrorCode,
  POIDisputeAttributes,
  IndexingStatusResolver,
  BlockPointer,
  IndexingStatus,
  SubgraphIdentifierType,
  parseGraphQLIndexingStatus,
} from '@graphprotocol/indexer-common'
import pRetry from 'p-retry'

const POI_DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | BigNumber | number | null
> = {
  allocationID: x => x,
  subgraphDeploymentID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => x,
  allocationProof: x => x,
  closedEpoch: x => +x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => +x,
  closedEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => +x,
  previousEpochReferenceProof: x => x,
  status: x => x,
}

/**
 * Parses a POI dispute returned from the indexer management GraphQL
 * API into normalized form.
 */
const disputeFromGraphQL = (
  dispute: Partial<POIDisputeAttributes>,
): POIDisputeAttributes => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(dispute)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (POI_DISPUTES_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as POIDisputeAttributes
}

interface indexNode {
  id: string
  deployments: string[]
}

export class Indexer {
  statusResolver: IndexingStatusResolver
  rpc: RpcClient
  indexerManagement: IndexerManagementClient
  logger: Logger
  indexNodeIDs: string[]
  defaultAllocationAmount: BigNumber
  indexerAddress: string

  constructor(
    logger: Logger,
    adminEndpoint: string,
    statusResolver: IndexingStatusResolver,
    indexerManagement: IndexerManagementClient,
    indexNodeIDs: string[],
    defaultAllocationAmount: BigNumber,
    indexerAddress: string,
  ) {
    this.indexerManagement = indexerManagement
    this.statusResolver = statusResolver
    this.logger = logger
    this.indexerAddress = indexerAddress

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
          const node = indexNodes.find(node => node.id === status.node)
          node
            ? node.deployments.push(status.subgraphDeployment)
            : indexNodes.push({
                id: status.node,
                deployments: [status.subgraphDeployment],
              })
        },
      )

      this.logger.info(`Queried index nodes`, {
        indexNodes,
      })
      return indexNodes
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(
        `Failed to query index nodes API (Should get a different IE?)`,
        { err },
      )
      throw err
    }
  }

  async proofOfIndexing(
    deployment: SubgraphDeploymentID,
    block: BlockPointer,
    indexerAddress: string,
  ): Promise<string | undefined> {
    try {
      return await pRetry(
        async attempt => {
          const result = await this.statusResolver.statuses
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
                blockNumber: block.number,
                blockHash: block.hash,
                indexer: indexerAddress,
              },
            )
            .toPromise()

          if (result.error) {
            throw result.error
          }
          this.logger.trace('Reference PoI generated', {
            indexer: this.indexerAddress,
            subgraph: deployment.ipfsHash,
            block: block,
            proof: result.data.proofOfIndexing,
            attempt,
          })

          return result.data.proofOfIndexing
        },
        {
          retries: 10,
          onFailedAttempt: err => {
            this.logger.warn(`Proof of indexing could not be queried`, {
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE019, error)
      this.logger.error(`Failed to query proof of indexing`, {
        subgraph: deployment.ipfsHash,
        blockHash: block,
        indexer: this.indexerAddress,
        err: err,
      })
      return undefined
    }
  }

  async indexingRules(merged: boolean): Promise<IndexingRuleAttributes[]> {
    try {
      const result = await this.indexerManagement
        .query(
          gql`
            query indexingRules($merged: Boolean!) {
              indexingRules(merged: $merged) {
                identifier
                identifierType
                allocationAmount
                allocationLifetime
                autoRenewal
                parallelAllocations
                maxAllocationPercentage
                minSignal
                maxSignal
                minStake
                minAverageQueryFees
                custom
                decisionBasis
                requireSupported
              }
            }
          `,
          { merged },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }
      this.logger.debug('Fetched indexing rules', {
        count: result.data.indexingRules.length,
        rules: result.data.indexingRules.map((rule: IndexingRuleAttributes) => {
          return {
            identifier: rule.identifier,
            identifierType: rule.identifierType,
            decisionBasis: rule.decisionBasis,
          }
        }),
      })
      return result.data.indexingRules
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE025, error)
      this.logger.error(`Failed to query indexer management API`, { err })
      throw err
    }
  }

  async ensureGlobalIndexingRule(): Promise<void> {
    try {
      const globalRule = await this.indexerManagement
        .query(
          gql`
            query indexingRule($identifier: String!) {
              indexingRule(identifier: $identifier, merged: false) {
                identifier
                identifierType
                allocationAmount
                decisionBasis
                requireSupported
              }
            }
          `,
          { identifier: INDEXING_RULE_GLOBAL },
        )
        .toPromise()

      if (!globalRule.data.indexingRule) {
        this.logger.info(`Creating default "global" indexing rule`)

        const defaults = {
          identifier: INDEXING_RULE_GLOBAL,
          identifierType: SubgraphIdentifierType.GROUP,
          allocationAmount: this.defaultAllocationAmount.toString(),
          parallelAllocations: 1,
          decisionBasis: 'rules',
          requireSupported: true,
        }

        const defaultGlobalRule = await this.indexerManagement
          .mutation(
            gql`
              mutation setIndexingRule($rule: IndexingRuleInput!) {
                setIndexingRule(rule: $rule) {
                  identifier
                  identifierType
                  allocationAmount
                  allocationLifetime
                  autoRenewal
                  parallelAllocations
                  maxAllocationPercentage
                  minSignal
                  maxSignal
                  minStake
                  minAverageQueryFees
                  custom
                  decisionBasis
                  requireSupported
                }
              }
            `,
            { rule: defaults },
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
      const err = indexerError(IndexerErrorCode.IE017, error)
      this.logger.error('Failed to ensure default "global" indexing rule', {
        err,
      })
      throw err
    }
  }

  async storePoiDisputes(
    disputes: POIDisputeAttributes[],
  ): Promise<POIDisputeAttributes[]> {
    try {
      const result = await this.indexerManagement
        .mutation(
          gql`
            mutation storeDisputes($disputes: [POIDisputeInput!]!) {
              storeDisputes(disputes: $disputes) {
                allocationID
                subgraphDeploymentID
                allocationIndexer
                allocationAmount
                allocationProof
                closedEpoch
                closedEpochStartBlockHash
                closedEpochStartBlockNumber
                closedEpochReferenceProof
                previousEpochStartBlockHash
                previousEpochStartBlockNumber
                previousEpochReferenceProof
                status
              }
            }
          `,
          { disputes: disputes },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.storeDisputes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dispute: Record<string, any>) => {
          return disputeFromGraphQL(dispute)
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE039, error)
      this.logger.error('Failed to store potential PoI disputes', {
        err,
      })
      throw err
    }
  }

  async fetchPOIDisputes(
    status: string,
    minClosedEpoch: number,
  ): Promise<POIDisputeAttributes[]> {
    try {
      const result = await this.indexerManagement
        .query(
          gql`
            query disputes($status: String!, $minClosedEpoch: Int!) {
              disputes(status: $status, minClosedEpoch: $minClosedEpoch) {
                allocationID
                subgraphDeploymentID
                allocationIndexer
                allocationAmount
                allocationProof
                closedEpoch
                closedEpochStartBlockHash
                closedEpochStartBlockNumber
                closedEpochReferenceProof
                previousEpochStartBlockHash
                previousEpochStartBlockNumber
                previousEpochReferenceProof
                status
              }
            }
          `,
          {
            status,
            minClosedEpoch,
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.disputes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dispute: Record<string, any>) => {
          return disputeFromGraphQL(dispute)
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE039, error)
      this.logger.error('Failed to store potential POI disputes', {
        err,
      })
      throw err
    }
  }

  async indexingStatus(
    deployment: SubgraphDeploymentID,
  ): Promise<IndexingStatus> {
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
      const usedIndexNodeIDs = indexNodes.map(node => node.id)
      const unusedNodes = this.indexNodeIDs.filter(
        nodeID => !(nodeID in usedIndexNodeIDs),
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
