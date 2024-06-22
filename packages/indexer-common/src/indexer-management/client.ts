import { buildSchema, print } from 'graphql'
import gql from 'graphql-tag'
import { executeExchange } from '@urql/exchange-execute'
import { Client, ClientOptions } from '@urql/core'
import { equal, Logger, mutable, WritableEventual } from '@graphprotocol/common-ts'

import { IndexerManagementModels, IndexingRuleCreationAttributes } from './models'

import actionResolvers from './resolvers/actions'
import allocationResolvers from './resolvers/allocations'
import costModelResolvers from './resolvers/cost-models'
import indexingRuleResolvers from './resolvers/indexing-rules'
import poiDisputeResolvers from './resolvers/poi-disputes'
import statusResolvers from './resolvers/indexer-status'
import { BigNumber } from 'ethers'
import { Op, Sequelize } from 'sequelize'
import { GraphNode } from '../graph-node'
import { ActionManager, MultiNetworks, Network } from '@graphprotocol/indexer-common'

export interface IndexerManagementResolverContext {
  models: IndexerManagementModels
  graphNode: GraphNode
  logger: Logger
  defaults: IndexerManagementDefaults
  actionManager: ActionManager | undefined
  multiNetworks: MultiNetworks<Network> | undefined
  dai: WritableEventual<string>
}

const SCHEMA_SDL = gql`
  scalar BigInt

  enum OrderDirection {
    asc
    desc
  }

  enum IndexingDecisionBasis {
    rules
    never
    always
    offchain
  }

  enum IdentifierType {
    deployment
    subgraph
    group
  }

  input AllocationFilter {
    status: String
    allocation: String
    subgraphDeployment: String
    protocolNetwork: String
  }

  enum AllocationStatus {
    Null # == indexer == address(0)
    Active # == not Null && tokens > 0 #
    Closed # == Active && closedAtEpoch != 0. Still can collect, while you are waiting to be finalized. a.k.a settling
    Finalized # == Closing && closedAtEpoch + channelDisputeEpochs > now(). Note, the subgraph has no way to return this value. it is implied
    Claimed # == not Null && tokens == 0 - i.e. finalized, and all tokens withdrawn
  }

  type Allocation {
    id: String!
    indexer: String!
    subgraphDeployment: String!
    allocatedTokens: String!
    createdAtEpoch: Int!
    closedAtEpoch: Int
    ageInEpochs: Int!
    indexingRewards: String!
    queryFeesCollected: String!
    signalledTokens: BigInt!
    stakedTokens: BigInt!
    status: AllocationStatus!
    protocolNetwork: String!
  }

  type CreateAllocationResult {
    allocation: String!
    deployment: String!
    allocatedTokens: String!
    protocolNetwork: String!
  }

  type CloseAllocationResult {
    allocation: String!
    allocatedTokens: String!
    indexingRewards: String!
    receiptsWorthCollecting: Boolean!
    protocolNetwork: String!
  }

  type ReallocateAllocationResult {
    closedAllocation: String!
    indexingRewardsCollected: String!
    receiptsWorthCollecting: Boolean!
    createdAllocation: String!
    createdAllocationStake: String!
    protocolNetwork: String!
  }

  enum ActionStatus {
    queued
    approved
    pending
    success
    failed
    canceled
  }

  enum ActionType {
    allocate
    unallocate
    reallocate
  }

  type Action {
    id: Int!
    status: ActionStatus!
    type: ActionType!
    deploymentID: String
    allocationID: String
    amount: String
    poi: String
    force: Boolean
    priority: Int!
    source: String!
    reason: String!
    transaction: String
    failureReason: String
    createdAt: BigInt!
    updatedAt: BigInt
    protocolNetwork: String!
  }

  input ActionInput {
    status: ActionStatus!
    type: ActionType!
    deploymentID: String
    allocationID: String
    amount: String
    poi: String
    force: Boolean
    source: String!
    reason: String!
    priority: Int!
    protocolNetwork: String!
  }

  input ActionUpdateInput {
    id: Int
    deploymentID: String
    allocationID: String
    amount: Int
    poi: String
    force: Boolean
    type: ActionType
    status: ActionStatus
    reason: String
  }

  enum ActionParams {
    id
    status
    type
    deploymentID
    allocationID
    transaction
    amount
    poi
    force
    source
    reason
    priority
    createdAt
    updatedAt
    protocolNetwork
  }

  type ActionResult {
    id: Int!
    type: ActionType!
    deploymentID: String
    allocationID: String
    amount: String
    poi: String
    force: Boolean
    source: String!
    reason: String!
    status: String!
    transaction: String
    failureReason: String
    priority: Int
    protocolNetwork: String!
  }

  input ActionFilter {
    id: Int
    protocolNetwork: String
    type: ActionType
    status: String
    source: String
    reason: String
  }

  input POIDisputeIdentifier {
    allocationID: String!
    protocolNetwork: String!
  }

  type POIDispute {
    allocationID: String!
    subgraphDeploymentID: String!
    allocationIndexer: String!
    allocationAmount: BigInt!
    allocationProof: String!
    closedEpoch: Int!
    closedEpochStartBlockHash: String!
    closedEpochStartBlockNumber: Int!
    closedEpochReferenceProof: String
    previousEpochStartBlockHash: String!
    previousEpochStartBlockNumber: Int!
    previousEpochReferenceProof: String
    status: String!
    protocolNetwork: String!
  }

  input POIDisputeInput {
    allocationID: String!
    subgraphDeploymentID: String!
    allocationIndexer: String!
    allocationAmount: BigInt!
    allocationProof: String!
    closedEpoch: Int!
    closedEpochStartBlockHash: String!
    closedEpochStartBlockNumber: Int!
    closedEpochReferenceProof: String
    previousEpochStartBlockHash: String!
    previousEpochStartBlockNumber: Int!
    previousEpochReferenceProof: String
    status: String!
    protocolNetwork: String!
  }

  type IndexingRule {
    identifier: String!
    identifierType: IdentifierType!
    allocationAmount: BigInt
    allocationLifetime: Int
    autoRenewal: Boolean!
    parallelAllocations: Int
    maxAllocationPercentage: Float
    minSignal: BigInt
    maxSignal: BigInt
    minStake: BigInt
    minAverageQueryFees: BigInt
    custom: String
    decisionBasis: IndexingDecisionBasis!
    requireSupported: Boolean!
    safety: Boolean!
    protocolNetwork: String!
    tag: String
  }

  input IndexingRuleInput {
    identifier: String!
    identifierType: IdentifierType!
    allocationAmount: BigInt
    allocationLifetime: Int
    autoRenewal: Boolean
    parallelAllocations: Int
    maxAllocationPercentage: Float
    minSignal: BigInt
    maxSignal: BigInt
    minStake: BigInt
    minAverageQueryFees: BigInt
    custom: String
    decisionBasis: IndexingDecisionBasis
    requireSupported: Boolean
    safety: Boolean
    protocolNetwork: String!
    tag: String
  }

  input IndexingRuleIdentifier {
    identifier: String!
    protocolNetwork: String!
  }

  type GeoLocation {
    latitude: String!
    longitude: String!
  }

  type IndexerRegistration {
    url: String
    protocolNetwork: String!
    address: String
    registered: Boolean!
    location: GeoLocation
  }

  type IndexingError {
    handler: String
    message: String!
  }

  type BlockPointer {
    number: Int!
    hash: String!
  }

  type ChainIndexingStatus {
    network: String!
    latestBlock: BlockPointer
    chainHeadBlock: BlockPointer
    earliestBlock: BlockPointer
  }

  type IndexerDeployment {
    subgraphDeployment: String!
    synced: Boolean!
    health: String!
    fatalError: IndexingError
    node: String
    chains: [ChainIndexingStatus]
  }

  type IndexerAllocation {
    id: String!
    allocatedTokens: BigInt!
    createdAtEpoch: Int!
    closedAtEpoch: Int
    subgraphDeployment: String!
    signalledTokens: BigInt!
    stakedTokens: BigInt!
  }

  type IndexerEndpointTest {
    test: String!
    error: String
    possibleActions: [String]!
  }

  type IndexerEndpoint {
    url: String
    healthy: Boolean!
    protocolNetwork: String!
    tests: [IndexerEndpointTest!]!
  }

  type IndexerEndpoints {
    service: IndexerEndpoint!
    status: IndexerEndpoint!
  }

  type CostModel {
    deployment: String!
    model: String
    variables: String
  }

  input CostModelInput {
    deployment: String!
    model: String
    variables: String
  }

  type Query {
    indexingRule(
      identifier: IndexingRuleIdentifier!
      merged: Boolean! = false
    ): IndexingRule
    indexingRules(merged: Boolean! = false, protocolNetwork: String): [IndexingRule!]!
    indexerRegistration(protocolNetwork: String!): IndexerRegistration!
    indexerDeployments: [IndexerDeployment]!
    indexerAllocations(protocolNetwork: String!): [IndexerAllocation]!
    indexerEndpoints(protocolNetwork: String): [IndexerEndpoints!]!

    costModels(deployments: [String!]): [CostModel!]!
    costModel(deployment: String!): CostModel

    dispute(identifier: POIDisputeIdentifier!): POIDispute
    disputes(
      status: String!
      minClosedEpoch: Int!
      protocolNetwork: String
    ): [POIDispute]!
    disputesClosedAfter(closedAfterBlock: BigInt!, protocolNetwork: String): [POIDispute]!

    allocations(filter: AllocationFilter!): [Allocation!]!

    action(actionID: String!): Action
    actions(
      filter: ActionFilter
      orderBy: ActionParams
      orderDirection: OrderDirection
      first: Int
    ): [Action]!
  }

  type Mutation {
    setIndexingRule(rule: IndexingRuleInput!): IndexingRule!
    deleteIndexingRule(identifier: IndexingRuleIdentifier!): Boolean!
    deleteIndexingRules(identifiers: [IndexingRuleIdentifier!]!): Boolean!

    setCostModel(costModel: CostModelInput!): CostModel!
    deleteCostModels(deployments: [String!]!): Int!

    storeDisputes(disputes: [POIDisputeInput!]!): [POIDispute!]
    deleteDisputes(identifiers: [POIDisputeIdentifier!]!): Int!

    createAllocation(
      deployment: String!
      amount: String!
      indexNode: String
      protocolNetwork: String!
    ): CreateAllocationResult!
    closeAllocation(
      allocation: String!
      poi: String
      force: Boolean
      protocolNetwork: String!
    ): CloseAllocationResult!
    reallocateAllocation(
      allocation: String!
      poi: String
      amount: String!
      force: Boolean
      protocolNetwork: String!
    ): ReallocateAllocationResult!

    updateAction(action: ActionInput!): Action!
    updateActions(filter: ActionFilter!, action: ActionUpdateInput!): [Action]!
    queueActions(actions: [ActionInput!]!): [Action]!
    cancelActions(actionIDs: [String!]!): [Action]!
    deleteActions(actionIDs: [String!]!): Int!
    approveActions(actionIDs: [String!]!): [Action]!
    executeApprovedActions: [ActionResult!]!
  }
`

export interface IndexerManagementDefaults {
  globalIndexingRule: Omit<
    IndexingRuleCreationAttributes,
    'identifier' | 'allocationAmount'
  > & { allocationAmount: BigNumber }
}

export interface IndexerManagementClientOptions {
  logger: Logger
  models: IndexerManagementModels
  graphNode: GraphNode
  // TODO:L2: Do we need this information? The GraphNode class auto-selects nodes based
  // on availability.
  // Ford: there were some edge cases where the GraphNode was not able to auto handle it on its own
  indexNodeIDs: string[]
  multiNetworks: MultiNetworks<Network> | undefined
  defaults: IndexerManagementDefaults
}

export class IndexerManagementClient extends Client {
  private logger?: Logger
  private models: IndexerManagementModels
  private dai: WritableEventual<string>

  constructor(
    clientOptions: ClientOptions,
    options: IndexerManagementClientOptions,
    featureOptions: { dai: WritableEventual<string> },
  ) {
    super(clientOptions)

    this.logger = options.logger
    this.models = options.models
    this.dai = featureOptions.dai
  }

  public async setDai(value: string): Promise<void> {
    // Get current value
    const oldValue = this.dai.valueReady ? await this.dai.value() : undefined

    // Don't do anything if there is no change
    if (equal(oldValue, value)) {
      return
    }

    // Notify others of the new value
    this.dai.push(value)

    // Update DAI in all cost models
    const update = `'${JSON.stringify({ DAI: value })}'::jsonb`
    await this.models.CostModel.update(
      {
        // This merges DAI into the variables, overwriting existing values
        variables: Sequelize.literal(`coalesce(variables, '{}'::jsonb) || ${update}`),
      },
      {
        // TODO: update to match all rows??
        where: { model: { [Op.not]: null } },
      },
    )
  }
}

// TODO:L2: Put the IndexerManagementClient creation inside the Agent, and receive
// MultiNetworks from it
export const createIndexerManagementClient = async (
  options: IndexerManagementClientOptions,
): Promise<IndexerManagementClient> => {
  const { models, graphNode, logger, defaults, multiNetworks } = options
  const schema = buildSchema(print(SCHEMA_SDL))
  const resolvers = {
    ...indexingRuleResolvers,
    ...statusResolvers,
    ...costModelResolvers,
    ...poiDisputeResolvers,
    ...allocationResolvers,
    ...actionResolvers,
  }

  const dai: WritableEventual<string> = mutable()

  const actionManager = multiNetworks
    ? await ActionManager.create(multiNetworks, logger, models, graphNode)
    : undefined

  const context: IndexerManagementResolverContext = {
    models,
    graphNode,
    defaults,
    logger: logger.child({ component: 'IndexerManagementClient' }),
    dai,
    multiNetworks,
    actionManager,
  }

  const exchange = executeExchange({
    schema,
    rootValue: resolvers,
    context,
  })

  return new IndexerManagementClient({ url: 'no-op', exchanges: [exchange] }, options, {
    dai,
  })
}
