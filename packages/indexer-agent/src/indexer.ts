import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import { BigNumber, utils } from 'ethers'
import {
  formatGRT,
  Logger,
  SubgraphDeploymentID,
} from '@tokene-q/common-ts'
import {
  IndexingRuleAttributes,
  IndexerManagementClient,
  INDEXING_RULE_GLOBAL,
  indexerError,
  IndexerErrorCode,
  POIDisputeAttributes,
  IndexingStatusResolver,
  IndexingStatus,
  SubgraphIdentifierType,
  parseGraphQLIndexingStatus,
  CostModelAttributes,
  ActionResult,
  ActionItem,
  Action,
  ActionStatus,
  AllocationManagementMode,
  ActionInput,
  ActionType,
  Allocation,
  AllocationDecision,
  ActionFilter,
} from '@graphprotocol/indexer-common'
import { CombinedError } from '@urql/core'
import pMap from 'p-map'

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
  allocationManagementMode: AllocationManagementMode

  constructor(
    logger: Logger,
    adminEndpoint: string,
    statusResolver: IndexingStatusResolver,
    indexerManagement: IndexerManagementClient,
    indexNodeIDs: string[],
    defaultAllocationAmount: BigNumber,
    indexerAddress: string,
    allocationManagementMode: AllocationManagementMode,
  ) {
    this.indexerManagement = indexerManagement
    this.statusResolver = statusResolver
    this.logger = logger
    this.indexerAddress = indexerAddress
    this.allocationManagementMode = allocationManagementMode

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

      this.logger.trace(`Queried index nodes`, {
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
      this.logger.trace('Fetched indexing rules', {
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
          safety: true,
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
                  safety
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
      this.logger.warn('Failed to ensure default "global" indexing rule', {
        err,
      })
      throw err
    }
  }

  async costModels(
    deployments: SubgraphDeploymentID[],
  ): Promise<CostModelAttributes[]> {
    try {
      const result = await this.indexerManagement
        .query(
          gql`
            query costModels($deployments: [String!]!) {
              costModels(deployments: $deployments) {
                deployment
                model
                variables
              }
            }
          `,
          {
            deployments: deployments.map(deployment => deployment.bytes32),
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }
      return result.data.costModels
    } catch (error) {
      this.logger.warn(`Failed to query cost models`, { error })
      throw error
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
      this.logger.error('Failed to store potential POI disputes', {
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

  async fetchActions(actionFilter: ActionFilter): Promise<ActionResult[]> {
    const result = await this.indexerManagement
      .query(
        gql`
          query actions($filter: ActionFilter!) {
            actions(filter: $filter) {
              id
              type
              allocationID
              deploymentID
              amount
              poi
              force
              source
              reason
              priority
              transaction
              status
              failureReason
            }
          }
        `,
        { filter: actionFilter },
      )
      .toPromise()

    if (result.error) {
      throw result.error
    }

    return result.data.actions
  }

  async queueAction(action: ActionItem): Promise<Action[]> {
    let status = ActionStatus.QUEUED
    switch (this.allocationManagementMode) {
      case AllocationManagementMode.MANUAL:
        throw Error(
          `Cannot queue actions when AllocationManagementMode = 'MANUAL'`,
        )
      case AllocationManagementMode.AUTO:
        status = ActionStatus.APPROVED
        break
      case AllocationManagementMode.OVERSIGHT:
        status = ActionStatus.QUEUED
    }

    const actionInput = {
      ...action.params,
      status,
      type: action.type,
      source: 'indexerAgent',
      reason: action.reason,
      priority: 0,
    } as ActionInput

    const actionResult = await this.indexerManagement
      .mutation(
        gql`
          mutation queueActions($actions: [ActionInput!]!) {
            queueActions(actions: $actions) {
              id
              type
              deploymentID
              source
              reason
              priority
              status
            }
          }
        `,
        { actions: [actionInput] },
      )
      .toPromise()

    if (actionResult.error) {
      if (
        actionResult.error instanceof CombinedError &&
        actionResult.error.message.includes('Duplicate')
      ) {
        this.logger.warn(
          `Action not queued: Already a queued action targeting ${actionInput.deploymentID} from another source`,
          { action },
        )
        return []
      }
      throw actionResult.error
    }

    if (actionResult.data.queueActions.length > 0) {
      this.logger.info(`Queued ${action.type} action for execution`, {
        queuedAction: actionResult.data.queueActions,
      })
    }

    return actionResult.data.queueActions
  }

  async createAllocation(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    mostRecentlyClosedAllocation: Allocation,
  ): Promise<void> {
    const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch.rule
      ?.allocationAmount
      ? BigNumber.from(
          deploymentAllocationDecision.ruleMatch.rule.allocationAmount,
        )
      : this.defaultAllocationAmount

    logger.info(`No active allocation for deployment, creating one now`, {
      allocationAmount: formatGRT(desiredAllocationAmount),
    })

    // Skip allocating if the previous allocation for this deployment was closed with 0x00 POI but rules set to un-safe
    if (
      deploymentAllocationDecision.ruleMatch.rule?.safety &&
      mostRecentlyClosedAllocation &&
      mostRecentlyClosedAllocation.poi === utils.hexlify(Array(32).fill(0))
    ) {
      logger.warn(
        `Skipping allocation to this deployment as the last allocation to it was closed with a zero POI`,
        {
          notSafe: !deploymentAllocationDecision.ruleMatch.rule?.safety,
          deployment: deploymentAllocationDecision.deployment,
          closedAllocation: mostRecentlyClosedAllocation.id,
        },
      )
      return
    }

    // Send AllocateAction to the queue
    await this.queueAction({
      params: {
        deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
        amount: formatGRT(desiredAllocationAmount),
      },
      type: ActionType.ALLOCATE,
      reason: deploymentAllocationDecision.reasonString(),
    })

    return
  }

  async closeEligibleAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    activeDeploymentAllocations: Allocation[],
    epoch: number,
  ): Promise<void> {
    const activeDeploymentAllocationsEligibleForClose =
      activeDeploymentAllocations
        .filter(allocation => allocation.createdAtEpoch < epoch)
        .map(allocation => allocation.id)
    // Make sure to close all active allocations on the way out
    if (activeDeploymentAllocationsEligibleForClose.length > 0) {
      logger.info(
        `Deployment is not (or no longer) worth allocating towards, close allocation`,
        {
          eligibleForClose: activeDeploymentAllocationsEligibleForClose,
        },
      )
      await pMap(
        // We can only close allocations from a previous epoch;
        // try the others again later
        activeDeploymentAllocationsEligibleForClose,
        async allocation => {
          // Send unallocate action to the queue
          await this.queueAction({
            params: {
              allocationID: allocation,
              deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
              poi: undefined,
              force: false,
            },
            type: ActionType.UNALLOCATE,
            reason: deploymentAllocationDecision.reasonString(),
          } as ActionItem)
        },
        { concurrency: 1 },
      )
    }
  }

  async refreshExpiredAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    expiredAllocations: Allocation[],
  ): Promise<void> {
    if (deploymentAllocationDecision.ruleMatch.rule?.autoRenewal) {
      logger.info(`Reallocating expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map(allocation => allocation.id),
      })

      const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch
        .rule?.allocationAmount
        ? BigNumber.from(
            deploymentAllocationDecision.ruleMatch.rule.allocationAmount,
          )
        : this.defaultAllocationAmount

      // Queue reallocate actions to be picked up by the worker
      await pMap(expiredAllocations, async allocation => {
        await this.queueAction({
          params: {
            allocationID: allocation.id,
            deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
            amount: formatGRT(desiredAllocationAmount),
          },
          type: ActionType.REALLOCATE,
          reason: `${deploymentAllocationDecision.reasonString()}:allocationExpiring`, // Need to update to include 'ExpiringSoon'
        })
      })
    } else {
      logger.info(
        `Skipping reallocating expired allocation since the corresponding rule has 'autoRenewal' = False`,
        {
          number: expiredAllocations.length,
          expiredAllocations: expiredAllocations.map(
            allocation => allocation.id,
          ),
        },
      )
    }
    return
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
