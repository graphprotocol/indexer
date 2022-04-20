import { buildSchema, print } from 'graphql'
import gql from 'graphql-tag'
import { executeExchange } from '@urql/exchange-execute'
import { Client, ClientOptions } from '@urql/core'
import {
  equal,
  Eventual,
  Logger,
  mutable,
  NetworkContracts,
  WritableEventual,
} from '@graphprotocol/common-ts'
import { NetworkSubgraph } from '../network-subgraph'

import { IndexerManagementModels, IndexingRuleCreationAttributes } from './models'

import allocationResolvers from './resolvers/allocations'
import costModelResolvers from './resolvers/cost-models'
import indexingRuleResolvers from './resolvers/indexing-rules'
import poiDisputeResolvers from './resolvers/poi-disputes'
import statusResolvers from './resolvers/indexer-status'
import { BigNumber } from 'ethers'
import { Op, Sequelize } from 'sequelize'
import { IndexingStatusResolver } from '../indexing-status'
import { TransactionManager } from '../transactions'
import { SubgraphManager } from './subgraphs'
import { AllocationReceiptCollector } from '../allocations/query-fees'

export interface IndexerManagementFeatures {
  injectDai: boolean
}

export interface IndexerManagementResolverContext {
  models: IndexerManagementModels
  address: string
  contracts: NetworkContracts
  indexingStatusResolver: IndexingStatusResolver
  subgraphManager: SubgraphManager
  networkSubgraph: NetworkSubgraph
  logger: Logger
  defaults: IndexerManagementDefaults
  features: IndexerManagementFeatures
  dai: Eventual<string>
  transactionManager: TransactionManager
  receiptCollector: AllocationReceiptCollector
}

const SCHEMA_SDL = gql`
  scalar BigInt

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
  }

  type CreateAllocationResult {
    allocation: String!
    deployment: String!
    allocatedTokens: String!
  }

  type CloseAllocationResult {
    allocation: String!
    allocatedTokens: String!
    indexingRewards: String!
    receiptsWorthCollecting: Boolean!
  }

  type reallocateAllocationResult {
    closedAllocation: String!
    indexingRewardsCollected: String!
    receiptsWorthCollecting: Boolean!
    createdAllocation: String!
    createdAllocationStake: String!
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
  }

  type GeoLocation {
    latitude: String!
    longitude: String!
  }

  type IndexerRegistration {
    url: String
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
    latestBlock: BlockPointer!
    chainHeadBlock: BlockPointer!
    earliestBlock: BlockPointer
  }

  type IndexerDeployment {
    subgraphDeployment: String!
    synced: Boolean!
    health: String!
    fatalError: IndexingError
    node: String!
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
    indexingRule(identifier: String!, merged: Boolean! = false): IndexingRule
    indexingRules(merged: Boolean! = false): [IndexingRule!]!
    indexerRegistration: IndexerRegistration!
    indexerDeployments: [IndexerDeployment]!
    indexerAllocations: [IndexerAllocation]!
    indexerEndpoints: IndexerEndpoints!

    costModels(deployments: [String!]): [CostModel!]!
    costModel(deployment: String!): CostModel

    dispute(allocationID: String!): POIDispute
    disputes(status: String!, minClosedEpoch: Int!): [POIDispute]!
    disputesClosedAfter(closedAfterBlock: BigInt!): [POIDispute]!

    allocations(filter: AllocationFilter!): [Allocation!]!
  }

  type Mutation {
    setIndexingRule(rule: IndexingRuleInput!): IndexingRule!
    deleteIndexingRule(identifier: String!): Boolean!
    deleteIndexingRules(identifiers: [String!]!): Boolean!

    setCostModel(costModel: CostModelInput!): CostModel!

    storeDisputes(disputes: [POIDisputeInput!]!): [POIDispute!]
    deleteDisputes(allocationIDs: [String!]!): Int!

    createAllocation(
      deployment: String!
      amount: String!
      indexNode: String
    ): CreateAllocationResult!
    closeAllocation(
      allocation: String!
      poi: String
      force: Boolean
    ): CloseAllocationResult!
    reallocateAllocation(
      allocation: String!
      poi: String
      amount: String!
      force: Boolean
    ): reallocateAllocationResult!
  }
`

export interface IndexerManagementDefaults {
  globalIndexingRule: Omit<
    IndexingRuleCreationAttributes,
    'identifier' | 'allocationAmount'
  > & { allocationAmount: BigNumber }
}

export interface IndexerManagementClientOptions {
  models: IndexerManagementModels
  address: string
  contracts: NetworkContracts
  indexingStatusResolver: IndexingStatusResolver
  indexNodeIDs: string[]
  deploymentManagementEndpoint: string
  networkSubgraph: NetworkSubgraph
  logger?: Logger
  defaults: IndexerManagementDefaults
  features: IndexerManagementFeatures
  transactionManager?: TransactionManager
  receiptCollector?: AllocationReceiptCollector
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
        // This is just a non-obvious way to match all models
        where: { deployment: { [Op.not]: null } },
      },
    )
  }
}

export const createIndexerManagementClient = async (
  options: IndexerManagementClientOptions,
): Promise<IndexerManagementClient> => {
  const {
    models,
    address,
    contracts,
    indexingStatusResolver,
    indexNodeIDs,
    deploymentManagementEndpoint,
    networkSubgraph,
    logger,
    defaults,
    features,
    transactionManager,
    receiptCollector,
  } = options
  const schema = buildSchema(print(SCHEMA_SDL))
  const resolvers = {
    ...indexingRuleResolvers,
    ...statusResolvers,
    ...costModelResolvers,
    ...poiDisputeResolvers,
    ...allocationResolvers,
  }

  const dai: WritableEventual<string> = mutable()

  const subgraphManager = new SubgraphManager(deploymentManagementEndpoint, indexNodeIDs)

  const exchange = executeExchange({
    schema,
    rootValue: resolvers,
    context: {
      models,
      address,
      contracts,
      indexingStatusResolver,
      subgraphManager,
      networkSubgraph,
      logger: logger ? logger.child({ component: 'IndexerManagementClient' }) : undefined,
      defaults,
      features,
      dai,
      transactionManager,
      receiptCollector,
    },
  })

  return new IndexerManagementClient({ url: 'no-op', exchanges: [exchange] }, options, {
    dai,
  })
}
