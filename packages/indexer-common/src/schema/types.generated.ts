import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql'
import { IndexerManagementResolverContext } from '@graphprotocol/indexer-common'
export type Maybe<T> = T | null | undefined
export type InputMaybe<T> = T | null | undefined
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>
}
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>
}
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = {
  [_ in K]?: never
}
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
export type RequireFields<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: NonNullable<T[P]>
}
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string }
  String: { input: string; output: string }
  Boolean: { input: boolean; output: boolean }
  Int: { input: number; output: number }
  Float: { input: number; output: number }
  BigInt: { input: any; output: any }
}

export type Action = {
  __typename?: 'Action'
  allocationID?: Maybe<Scalars['String']['output']>
  amount?: Maybe<Scalars['String']['output']>
  createdAt: Scalars['BigInt']['output']
  deploymentID?: Maybe<Scalars['String']['output']>
  failureReason?: Maybe<Scalars['String']['output']>
  force?: Maybe<Scalars['Boolean']['output']>
  id: Scalars['Int']['output']
  poi?: Maybe<Scalars['String']['output']>
  priority: Scalars['Int']['output']
  protocolNetwork: Scalars['String']['output']
  reason: Scalars['String']['output']
  source: Scalars['String']['output']
  status: ActionStatus
  transaction?: Maybe<Scalars['String']['output']>
  type: ActionType
  updatedAt?: Maybe<Scalars['BigInt']['output']>
}

export type ActionFilter = {
  id?: InputMaybe<Scalars['Int']['input']>
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
  reason?: InputMaybe<Scalars['String']['input']>
  source?: InputMaybe<Scalars['String']['input']>
  status?: InputMaybe<Scalars['String']['input']>
  type?: InputMaybe<ActionType>
}

export type ActionInput = {
  allocationID?: InputMaybe<Scalars['String']['input']>
  amount?: InputMaybe<Scalars['String']['input']>
  deploymentID?: InputMaybe<Scalars['String']['input']>
  force?: InputMaybe<Scalars['Boolean']['input']>
  poi?: InputMaybe<Scalars['String']['input']>
  priority: Scalars['Int']['input']
  protocolNetwork: Scalars['String']['input']
  reason: Scalars['String']['input']
  source: Scalars['String']['input']
  status: ActionStatus
  type: ActionType
}

export type ActionParams =
  | 'allocationID'
  | 'amount'
  | 'createdAt'
  | 'deploymentID'
  | 'force'
  | 'id'
  | 'poi'
  | 'priority'
  | 'protocolNetwork'
  | 'reason'
  | 'source'
  | 'status'
  | 'transaction'
  | 'type'
  | 'updatedAt'

export type ActionResult = {
  __typename?: 'ActionResult'
  allocationID?: Maybe<Scalars['String']['output']>
  amount?: Maybe<Scalars['String']['output']>
  deploymentID?: Maybe<Scalars['String']['output']>
  failureReason?: Maybe<Scalars['String']['output']>
  force?: Maybe<Scalars['Boolean']['output']>
  id: Scalars['Int']['output']
  poi?: Maybe<Scalars['String']['output']>
  priority?: Maybe<Scalars['Int']['output']>
  protocolNetwork: Scalars['String']['output']
  reason: Scalars['String']['output']
  source: Scalars['String']['output']
  status: Scalars['String']['output']
  transaction?: Maybe<Scalars['String']['output']>
  type: ActionType
}

export type ActionStatus =
  | 'approved'
  | 'canceled'
  | 'failed'
  | 'pending'
  | 'queued'
  | 'success'

export type ActionType = 'allocate' | 'reallocate' | 'unallocate'

export type ActionUpdateInput = {
  allocationID?: InputMaybe<Scalars['String']['input']>
  amount?: InputMaybe<Scalars['Int']['input']>
  deploymentID?: InputMaybe<Scalars['String']['input']>
  force?: InputMaybe<Scalars['Boolean']['input']>
  id?: InputMaybe<Scalars['Int']['input']>
  poi?: InputMaybe<Scalars['String']['input']>
  reason?: InputMaybe<Scalars['String']['input']>
  status?: InputMaybe<ActionStatus>
  type?: InputMaybe<ActionType>
}

export type Allocation = {
  __typename?: 'Allocation'
  ageInEpochs: Scalars['Int']['output']
  allocatedTokens: Scalars['String']['output']
  closedAtEpoch?: Maybe<Scalars['Int']['output']>
  createdAtEpoch: Scalars['Int']['output']
  id: Scalars['String']['output']
  indexer: Scalars['String']['output']
  indexingRewards: Scalars['String']['output']
  protocolNetwork: Scalars['String']['output']
  queryFeesCollected: Scalars['String']['output']
  signalledTokens: Scalars['BigInt']['output']
  stakedTokens: Scalars['BigInt']['output']
  status: AllocationStatus
  subgraphDeployment: Scalars['String']['output']
}

export type AllocationFilter = {
  allocation?: InputMaybe<Scalars['String']['input']>
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
  status?: InputMaybe<Scalars['String']['input']>
  subgraphDeployment?: InputMaybe<Scalars['String']['input']>
}

export type AllocationStatus = 'Active' | 'Claimed' | 'Closed' | 'Finalized' | 'Null'

export type BlockPointer = {
  __typename?: 'BlockPointer'
  hash: Scalars['String']['output']
  number: Scalars['Int']['output']
}

export type ChainIndexingStatus = {
  __typename?: 'ChainIndexingStatus'
  chainHeadBlock?: Maybe<BlockPointer>
  earliestBlock?: Maybe<BlockPointer>
  latestBlock?: Maybe<BlockPointer>
  network: Scalars['String']['output']
}

export type CloseAllocationResult = {
  __typename?: 'CloseAllocationResult'
  allocatedTokens: Scalars['String']['output']
  allocation: Scalars['String']['output']
  indexingRewards: Scalars['String']['output']
  protocolNetwork: Scalars['String']['output']
  receiptsWorthCollecting: Scalars['Boolean']['output']
}

export type CostModel = {
  __typename?: 'CostModel'
  deployment: Scalars['String']['output']
  model?: Maybe<Scalars['String']['output']>
  variables?: Maybe<Scalars['String']['output']>
}

export type CostModelInput = {
  deployment: Scalars['String']['input']
  model?: InputMaybe<Scalars['String']['input']>
  variables?: InputMaybe<Scalars['String']['input']>
}

export type CreateAllocationResult = {
  __typename?: 'CreateAllocationResult'
  allocatedTokens: Scalars['String']['output']
  allocation: Scalars['String']['output']
  deployment: Scalars['String']['output']
  protocolNetwork: Scalars['String']['output']
}

export type GeoLocation = {
  __typename?: 'GeoLocation'
  latitude: Scalars['String']['output']
  longitude: Scalars['String']['output']
}

export type IdentifierType = 'deployment' | 'group' | 'subgraph'

export type IndexerAllocation = {
  __typename?: 'IndexerAllocation'
  allocatedTokens: Scalars['BigInt']['output']
  closedAtEpoch?: Maybe<Scalars['Int']['output']>
  createdAtEpoch: Scalars['Int']['output']
  id: Scalars['String']['output']
  signalledTokens: Scalars['BigInt']['output']
  stakedTokens: Scalars['BigInt']['output']
  subgraphDeployment: Scalars['String']['output']
}

export type IndexerDeployment = {
  __typename?: 'IndexerDeployment'
  chains?: Maybe<Array<Maybe<ChainIndexingStatus>>>
  fatalError?: Maybe<IndexingError>
  health: Scalars['String']['output']
  node?: Maybe<Scalars['String']['output']>
  subgraphDeployment: Scalars['String']['output']
  synced: Scalars['Boolean']['output']
}

export type IndexerEndpoint = {
  __typename?: 'IndexerEndpoint'
  healthy: Scalars['Boolean']['output']
  protocolNetwork: Scalars['String']['output']
  tests: Array<IndexerEndpointTest>
  url?: Maybe<Scalars['String']['output']>
}

export type IndexerEndpointTest = {
  __typename?: 'IndexerEndpointTest'
  error?: Maybe<Scalars['String']['output']>
  possibleActions: Array<Maybe<Scalars['String']['output']>>
  test: Scalars['String']['output']
}

export type IndexerEndpoints = {
  __typename?: 'IndexerEndpoints'
  service: IndexerEndpoint
  status: IndexerEndpoint
}

export type IndexerRegistration = {
  __typename?: 'IndexerRegistration'
  address?: Maybe<Scalars['String']['output']>
  location?: Maybe<GeoLocation>
  protocolNetwork: Scalars['String']['output']
  registered: Scalars['Boolean']['output']
  url?: Maybe<Scalars['String']['output']>
}

export type IndexingDecisionBasis = 'always' | 'never' | 'offchain' | 'rules'

export type IndexingError = {
  __typename?: 'IndexingError'
  handler?: Maybe<Scalars['String']['output']>
  message: Scalars['String']['output']
}

export type IndexingRule = {
  __typename?: 'IndexingRule'
  allocationAmount?: Maybe<Scalars['BigInt']['output']>
  allocationLifetime?: Maybe<Scalars['Int']['output']>
  autoRenewal: Scalars['Boolean']['output']
  custom?: Maybe<Scalars['String']['output']>
  decisionBasis: IndexingDecisionBasis
  identifier: Scalars['String']['output']
  identifierType: IdentifierType
  maxAllocationPercentage?: Maybe<Scalars['Float']['output']>
  maxSignal?: Maybe<Scalars['BigInt']['output']>
  minAverageQueryFees?: Maybe<Scalars['BigInt']['output']>
  minSignal?: Maybe<Scalars['BigInt']['output']>
  minStake?: Maybe<Scalars['BigInt']['output']>
  parallelAllocations?: Maybe<Scalars['Int']['output']>
  protocolNetwork: Scalars['String']['output']
  requireSupported: Scalars['Boolean']['output']
  safety: Scalars['Boolean']['output']
}

export type IndexingRuleIdentifier = {
  identifier: Scalars['String']['input']
  protocolNetwork: Scalars['String']['input']
}

export type IndexingRuleInput = {
  allocationAmount?: InputMaybe<Scalars['BigInt']['input']>
  allocationLifetime?: InputMaybe<Scalars['Int']['input']>
  autoRenewal?: InputMaybe<Scalars['Boolean']['input']>
  custom?: InputMaybe<Scalars['String']['input']>
  decisionBasis?: InputMaybe<IndexingDecisionBasis>
  identifier: Scalars['String']['input']
  identifierType: IdentifierType
  maxAllocationPercentage?: InputMaybe<Scalars['Float']['input']>
  maxSignal?: InputMaybe<Scalars['BigInt']['input']>
  minAverageQueryFees?: InputMaybe<Scalars['BigInt']['input']>
  minSignal?: InputMaybe<Scalars['BigInt']['input']>
  minStake?: InputMaybe<Scalars['BigInt']['input']>
  parallelAllocations?: InputMaybe<Scalars['Int']['input']>
  protocolNetwork: Scalars['String']['input']
  requireSupported?: InputMaybe<Scalars['Boolean']['input']>
  safety?: InputMaybe<Scalars['Boolean']['input']>
}

export type Mutation = {
  __typename?: 'Mutation'
  approveActions: Array<Maybe<Action>>
  cancelActions: Array<Maybe<Action>>
  closeAllocation: CloseAllocationResult
  createAllocation: CreateAllocationResult
  deleteActions: Scalars['Int']['output']
  deleteCostModels: Scalars['Int']['output']
  deleteDisputes: Scalars['Int']['output']
  deleteIndexingRule: Scalars['Boolean']['output']
  deleteIndexingRules: Scalars['Boolean']['output']
  executeApprovedActions: Array<ActionResult>
  queueActions: Array<Maybe<Action>>
  reallocateAllocation: ReallocateAllocationResult
  setCostModel: CostModel
  setIndexingRule: IndexingRule
  storeDisputes?: Maybe<Array<POIDispute>>
  updateAction: Action
  updateActions: Array<Maybe<Action>>
}

export type MutationapproveActionsArgs = {
  actionIDs: Array<Scalars['String']['input']>
}

export type MutationcancelActionsArgs = {
  actionIDs: Array<Scalars['String']['input']>
}

export type MutationcloseAllocationArgs = {
  allocation: Scalars['String']['input']
  force?: InputMaybe<Scalars['Boolean']['input']>
  poi?: InputMaybe<Scalars['String']['input']>
  protocolNetwork: Scalars['String']['input']
}

export type MutationcreateAllocationArgs = {
  amount: Scalars['String']['input']
  deployment: Scalars['String']['input']
  indexNode?: InputMaybe<Scalars['String']['input']>
  protocolNetwork: Scalars['String']['input']
}

export type MutationdeleteActionsArgs = {
  actionIDs: Array<Scalars['String']['input']>
}

export type MutationdeleteCostModelsArgs = {
  deployments: Array<Scalars['String']['input']>
}

export type MutationdeleteDisputesArgs = {
  identifiers: Array<POIDisputeIdentifier>
}

export type MutationdeleteIndexingRuleArgs = {
  identifier: IndexingRuleIdentifier
}

export type MutationdeleteIndexingRulesArgs = {
  identifiers: Array<IndexingRuleIdentifier>
}

export type MutationqueueActionsArgs = {
  actions: Array<ActionInput>
}

export type MutationreallocateAllocationArgs = {
  allocation: Scalars['String']['input']
  amount: Scalars['String']['input']
  force?: InputMaybe<Scalars['Boolean']['input']>
  poi?: InputMaybe<Scalars['String']['input']>
  protocolNetwork: Scalars['String']['input']
}

export type MutationsetCostModelArgs = {
  costModel: CostModelInput
}

export type MutationsetIndexingRuleArgs = {
  rule: IndexingRuleInput
}

export type MutationstoreDisputesArgs = {
  disputes: Array<POIDisputeInput>
}

export type MutationupdateActionArgs = {
  action: ActionInput
}

export type MutationupdateActionsArgs = {
  action: ActionUpdateInput
  filter: ActionFilter
}

export type OrderDirection = 'asc' | 'desc'

export type POIDispute = {
  __typename?: 'POIDispute'
  allocationAmount: Scalars['BigInt']['output']
  allocationID: Scalars['String']['output']
  allocationIndexer: Scalars['String']['output']
  allocationProof: Scalars['String']['output']
  closedEpoch: Scalars['Int']['output']
  closedEpochReferenceProof?: Maybe<Scalars['String']['output']>
  closedEpochStartBlockHash: Scalars['String']['output']
  closedEpochStartBlockNumber: Scalars['Int']['output']
  previousEpochReferenceProof?: Maybe<Scalars['String']['output']>
  previousEpochStartBlockHash: Scalars['String']['output']
  previousEpochStartBlockNumber: Scalars['Int']['output']
  protocolNetwork: Scalars['String']['output']
  status: Scalars['String']['output']
  subgraphDeploymentID: Scalars['String']['output']
}

export type POIDisputeIdentifier = {
  allocationID: Scalars['String']['input']
  protocolNetwork: Scalars['String']['input']
}

export type POIDisputeInput = {
  allocationAmount: Scalars['BigInt']['input']
  allocationID: Scalars['String']['input']
  allocationIndexer: Scalars['String']['input']
  allocationProof: Scalars['String']['input']
  closedEpoch: Scalars['Int']['input']
  closedEpochReferenceProof?: InputMaybe<Scalars['String']['input']>
  closedEpochStartBlockHash: Scalars['String']['input']
  closedEpochStartBlockNumber: Scalars['Int']['input']
  previousEpochReferenceProof?: InputMaybe<Scalars['String']['input']>
  previousEpochStartBlockHash: Scalars['String']['input']
  previousEpochStartBlockNumber: Scalars['Int']['input']
  protocolNetwork: Scalars['String']['input']
  status: Scalars['String']['input']
  subgraphDeploymentID: Scalars['String']['input']
}

export type Query = {
  __typename?: 'Query'
  action?: Maybe<Action>
  actions: Array<Maybe<Action>>
  allocations: Array<Allocation>
  costModel?: Maybe<CostModel>
  costModels: Array<CostModel>
  dispute?: Maybe<POIDispute>
  disputes: Array<Maybe<POIDispute>>
  disputesClosedAfter: Array<Maybe<POIDispute>>
  indexerAllocations: Array<Maybe<IndexerAllocation>>
  indexerDeployments: Array<Maybe<IndexerDeployment>>
  indexerEndpoints: Array<IndexerEndpoints>
  indexerRegistration: IndexerRegistration
  indexingRule?: Maybe<IndexingRule>
  indexingRules: Array<IndexingRule>
}

export type QueryactionArgs = {
  actionID: Scalars['String']['input']
}

export type QueryactionsArgs = {
  filter?: InputMaybe<ActionFilter>
  first?: InputMaybe<Scalars['Int']['input']>
  orderBy?: InputMaybe<ActionParams>
  orderDirection?: InputMaybe<OrderDirection>
}

export type QueryallocationsArgs = {
  filter: AllocationFilter
}

export type QuerycostModelArgs = {
  deployment: Scalars['String']['input']
}

export type QuerycostModelsArgs = {
  deployments?: InputMaybe<Array<Scalars['String']['input']>>
}

export type QuerydisputeArgs = {
  identifier: POIDisputeIdentifier
}

export type QuerydisputesArgs = {
  minClosedEpoch: Scalars['Int']['input']
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
  status: Scalars['String']['input']
}

export type QuerydisputesClosedAfterArgs = {
  closedAfterBlock: Scalars['BigInt']['input']
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
}

export type QueryindexerAllocationsArgs = {
  protocolNetwork: Scalars['String']['input']
}

export type QueryindexerEndpointsArgs = {
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
}

export type QueryindexerRegistrationArgs = {
  protocolNetwork: Scalars['String']['input']
}

export type QueryindexingRuleArgs = {
  identifier: IndexingRuleIdentifier
  merged?: Scalars['Boolean']['input']
}

export type QueryindexingRulesArgs = {
  merged?: Scalars['Boolean']['input']
  protocolNetwork?: InputMaybe<Scalars['String']['input']>
}

export type ReallocateAllocationResult = {
  __typename?: 'ReallocateAllocationResult'
  closedAllocation: Scalars['String']['output']
  createdAllocation: Scalars['String']['output']
  createdAllocationStake: Scalars['String']['output']
  indexingRewardsCollected: Scalars['String']['output']
  protocolNetwork: Scalars['String']['output']
  receiptsWorthCollecting: Scalars['Boolean']['output']
}

export type ResolverTypeWrapper<T> = Promise<T> | T

export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>
}
export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> =
  | ResolverFn<TResult, TParent, TContext, TArgs>
  | ResolverWithResolve<TResult, TParent, TContext, TArgs>

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => Promise<TResult> | TResult

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => TResult | Promise<TResult>

export interface SubscriptionSubscriberObject<
  TResult,
  TKey extends string,
  TParent,
  TContext,
  TArgs,
> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>

export type SubscriptionResolver<
  TResult,
  TKey extends string,
  TParent = {},
  TContext = {},
  TArgs = {},
> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo,
) => Maybe<TTypes> | Promise<Maybe<TTypes>>

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (
  obj: T,
  context: TContext,
  info: GraphQLResolveInfo,
) => boolean | Promise<boolean>

export type NextResolverFn<T> = () => Promise<T>

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
) => TResult | Promise<TResult>

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Action: ResolverTypeWrapper<Action>
  String: ResolverTypeWrapper<Scalars['String']['output']>
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>
  Int: ResolverTypeWrapper<Scalars['Int']['output']>
  ActionFilter: ActionFilter
  ActionInput: ActionInput
  ActionParams: ActionParams
  ActionResult: ResolverTypeWrapper<ActionResult>
  ActionStatus: ActionStatus
  ActionType: ActionType
  ActionUpdateInput: ActionUpdateInput
  Allocation: ResolverTypeWrapper<Allocation>
  AllocationFilter: AllocationFilter
  AllocationStatus: AllocationStatus
  BigInt: ResolverTypeWrapper<Scalars['BigInt']['output']>
  BlockPointer: ResolverTypeWrapper<BlockPointer>
  ChainIndexingStatus: ResolverTypeWrapper<ChainIndexingStatus>
  CloseAllocationResult: ResolverTypeWrapper<CloseAllocationResult>
  CostModel: ResolverTypeWrapper<CostModel>
  CostModelInput: CostModelInput
  CreateAllocationResult: ResolverTypeWrapper<CreateAllocationResult>
  GeoLocation: ResolverTypeWrapper<GeoLocation>
  IdentifierType: IdentifierType
  IndexerAllocation: ResolverTypeWrapper<IndexerAllocation>
  IndexerDeployment: ResolverTypeWrapper<IndexerDeployment>
  IndexerEndpoint: ResolverTypeWrapper<IndexerEndpoint>
  IndexerEndpointTest: ResolverTypeWrapper<IndexerEndpointTest>
  IndexerEndpoints: ResolverTypeWrapper<IndexerEndpoints>
  IndexerRegistration: ResolverTypeWrapper<IndexerRegistration>
  IndexingDecisionBasis: IndexingDecisionBasis
  IndexingError: ResolverTypeWrapper<IndexingError>
  IndexingRule: ResolverTypeWrapper<IndexingRule>
  Float: ResolverTypeWrapper<Scalars['Float']['output']>
  IndexingRuleIdentifier: IndexingRuleIdentifier
  IndexingRuleInput: IndexingRuleInput
  Mutation: ResolverTypeWrapper<{}>
  OrderDirection: OrderDirection
  POIDispute: ResolverTypeWrapper<POIDispute>
  POIDisputeIdentifier: POIDisputeIdentifier
  POIDisputeInput: POIDisputeInput
  Query: ResolverTypeWrapper<{}>
  ReallocateAllocationResult: ResolverTypeWrapper<ReallocateAllocationResult>
}

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Action: Action
  String: Scalars['String']['output']
  Boolean: Scalars['Boolean']['output']
  Int: Scalars['Int']['output']
  ActionFilter: ActionFilter
  ActionInput: ActionInput
  ActionResult: ActionResult
  ActionUpdateInput: ActionUpdateInput
  Allocation: Allocation
  AllocationFilter: AllocationFilter
  BigInt: Scalars['BigInt']['output']
  BlockPointer: BlockPointer
  ChainIndexingStatus: ChainIndexingStatus
  CloseAllocationResult: CloseAllocationResult
  CostModel: CostModel
  CostModelInput: CostModelInput
  CreateAllocationResult: CreateAllocationResult
  GeoLocation: GeoLocation
  IndexerAllocation: IndexerAllocation
  IndexerDeployment: IndexerDeployment
  IndexerEndpoint: IndexerEndpoint
  IndexerEndpointTest: IndexerEndpointTest
  IndexerEndpoints: IndexerEndpoints
  IndexerRegistration: IndexerRegistration
  IndexingError: IndexingError
  IndexingRule: IndexingRule
  Float: Scalars['Float']['output']
  IndexingRuleIdentifier: IndexingRuleIdentifier
  IndexingRuleInput: IndexingRuleInput
  Mutation: {}
  POIDispute: POIDispute
  POIDisputeIdentifier: POIDisputeIdentifier
  POIDisputeInput: POIDisputeInput
  Query: {}
  ReallocateAllocationResult: ReallocateAllocationResult
}

export type ActionResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends ResolversParentTypes['Action'] = ResolversParentTypes['Action'],
> = {
  allocationID?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  amount?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  createdAt?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  deploymentID?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  failureReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  force?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>
  id?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  poi?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  priority?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  status?: Resolver<ResolversTypes['ActionStatus'], ParentType, ContextType>
  transaction?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  type?: Resolver<ResolversTypes['ActionType'], ParentType, ContextType>
  updatedAt?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type ActionResultResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['ActionResult'] = ResolversParentTypes['ActionResult'],
> = {
  allocationID?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  amount?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  deploymentID?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  failureReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  force?: Resolver<Maybe<ResolversTypes['Boolean']>, ParentType, ContextType>
  id?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  poi?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  priority?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  source?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  transaction?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  type?: Resolver<ResolversTypes['ActionType'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type AllocationResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['Allocation'] = ResolversParentTypes['Allocation'],
> = {
  ageInEpochs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  allocatedTokens?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  closedAtEpoch?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>
  createdAtEpoch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  indexer?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  indexingRewards?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  queryFeesCollected?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  signalledTokens?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  stakedTokens?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  status?: Resolver<ResolversTypes['AllocationStatus'], ParentType, ContextType>
  subgraphDeployment?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export interface BigIntScalarConfig
  extends GraphQLScalarTypeConfig<ResolversTypes['BigInt'], any> {
  name: 'BigInt'
}

export type BlockPointerResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['BlockPointer'] = ResolversParentTypes['BlockPointer'],
> = {
  hash?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type ChainIndexingStatusResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['ChainIndexingStatus'] = ResolversParentTypes['ChainIndexingStatus'],
> = {
  chainHeadBlock?: Resolver<
    Maybe<ResolversTypes['BlockPointer']>,
    ParentType,
    ContextType
  >
  earliestBlock?: Resolver<Maybe<ResolversTypes['BlockPointer']>, ParentType, ContextType>
  latestBlock?: Resolver<Maybe<ResolversTypes['BlockPointer']>, ParentType, ContextType>
  network?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type CloseAllocationResultResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['CloseAllocationResult'] = ResolversParentTypes['CloseAllocationResult'],
> = {
  allocatedTokens?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  allocation?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  indexingRewards?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  receiptsWorthCollecting?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type CostModelResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['CostModel'] = ResolversParentTypes['CostModel'],
> = {
  deployment?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  model?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  variables?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type CreateAllocationResultResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['CreateAllocationResult'] = ResolversParentTypes['CreateAllocationResult'],
> = {
  allocatedTokens?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  allocation?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  deployment?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type GeoLocationResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['GeoLocation'] = ResolversParentTypes['GeoLocation'],
> = {
  latitude?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  longitude?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerAllocationResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerAllocation'] = ResolversParentTypes['IndexerAllocation'],
> = {
  allocatedTokens?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  closedAtEpoch?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>
  createdAtEpoch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  signalledTokens?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  stakedTokens?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  subgraphDeployment?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerDeploymentResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerDeployment'] = ResolversParentTypes['IndexerDeployment'],
> = {
  chains?: Resolver<
    Maybe<Array<Maybe<ResolversTypes['ChainIndexingStatus']>>>,
    ParentType,
    ContextType
  >
  fatalError?: Resolver<Maybe<ResolversTypes['IndexingError']>, ParentType, ContextType>
  health?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  node?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  subgraphDeployment?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  synced?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerEndpointResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerEndpoint'] = ResolversParentTypes['IndexerEndpoint'],
> = {
  healthy?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  tests?: Resolver<Array<ResolversTypes['IndexerEndpointTest']>, ParentType, ContextType>
  url?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerEndpointTestResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerEndpointTest'] = ResolversParentTypes['IndexerEndpointTest'],
> = {
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  possibleActions?: Resolver<
    Array<Maybe<ResolversTypes['String']>>,
    ParentType,
    ContextType
  >
  test?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerEndpointsResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerEndpoints'] = ResolversParentTypes['IndexerEndpoints'],
> = {
  service?: Resolver<ResolversTypes['IndexerEndpoint'], ParentType, ContextType>
  status?: Resolver<ResolversTypes['IndexerEndpoint'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexerRegistrationResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexerRegistration'] = ResolversParentTypes['IndexerRegistration'],
> = {
  address?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  location?: Resolver<Maybe<ResolversTypes['GeoLocation']>, ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  registered?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  url?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexingErrorResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexingError'] = ResolversParentTypes['IndexingError'],
> = {
  handler?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type IndexingRuleResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['IndexingRule'] = ResolversParentTypes['IndexingRule'],
> = {
  allocationAmount?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  allocationLifetime?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>
  autoRenewal?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  custom?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>
  decisionBasis?: Resolver<
    ResolversTypes['IndexingDecisionBasis'],
    ParentType,
    ContextType
  >
  identifier?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  identifierType?: Resolver<ResolversTypes['IdentifierType'], ParentType, ContextType>
  maxAllocationPercentage?: Resolver<
    Maybe<ResolversTypes['Float']>,
    ParentType,
    ContextType
  >
  maxSignal?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  minAverageQueryFees?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  minSignal?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  minStake?: Resolver<Maybe<ResolversTypes['BigInt']>, ParentType, ContextType>
  parallelAllocations?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  requireSupported?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  safety?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type MutationResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation'],
> = {
  approveActions?: Resolver<
    Array<Maybe<ResolversTypes['Action']>>,
    ParentType,
    ContextType,
    RequireFields<MutationapproveActionsArgs, 'actionIDs'>
  >
  cancelActions?: Resolver<
    Array<Maybe<ResolversTypes['Action']>>,
    ParentType,
    ContextType,
    RequireFields<MutationcancelActionsArgs, 'actionIDs'>
  >
  closeAllocation?: Resolver<
    ResolversTypes['CloseAllocationResult'],
    ParentType,
    ContextType,
    RequireFields<MutationcloseAllocationArgs, 'allocation' | 'protocolNetwork'>
  >
  createAllocation?: Resolver<
    ResolversTypes['CreateAllocationResult'],
    ParentType,
    ContextType,
    RequireFields<
      MutationcreateAllocationArgs,
      'amount' | 'deployment' | 'protocolNetwork'
    >
  >
  deleteActions?: Resolver<
    ResolversTypes['Int'],
    ParentType,
    ContextType,
    RequireFields<MutationdeleteActionsArgs, 'actionIDs'>
  >
  deleteCostModels?: Resolver<
    ResolversTypes['Int'],
    ParentType,
    ContextType,
    RequireFields<MutationdeleteCostModelsArgs, 'deployments'>
  >
  deleteDisputes?: Resolver<
    ResolversTypes['Int'],
    ParentType,
    ContextType,
    RequireFields<MutationdeleteDisputesArgs, 'identifiers'>
  >
  deleteIndexingRule?: Resolver<
    ResolversTypes['Boolean'],
    ParentType,
    ContextType,
    RequireFields<MutationdeleteIndexingRuleArgs, 'identifier'>
  >
  deleteIndexingRules?: Resolver<
    ResolversTypes['Boolean'],
    ParentType,
    ContextType,
    RequireFields<MutationdeleteIndexingRulesArgs, 'identifiers'>
  >
  executeApprovedActions?: Resolver<
    Array<ResolversTypes['ActionResult']>,
    ParentType,
    ContextType
  >
  queueActions?: Resolver<
    Array<Maybe<ResolversTypes['Action']>>,
    ParentType,
    ContextType,
    RequireFields<MutationqueueActionsArgs, 'actions'>
  >
  reallocateAllocation?: Resolver<
    ResolversTypes['ReallocateAllocationResult'],
    ParentType,
    ContextType,
    RequireFields<
      MutationreallocateAllocationArgs,
      'allocation' | 'amount' | 'protocolNetwork'
    >
  >
  setCostModel?: Resolver<
    ResolversTypes['CostModel'],
    ParentType,
    ContextType,
    RequireFields<MutationsetCostModelArgs, 'costModel'>
  >
  setIndexingRule?: Resolver<
    ResolversTypes['IndexingRule'],
    ParentType,
    ContextType,
    RequireFields<MutationsetIndexingRuleArgs, 'rule'>
  >
  storeDisputes?: Resolver<
    Maybe<Array<ResolversTypes['POIDispute']>>,
    ParentType,
    ContextType,
    RequireFields<MutationstoreDisputesArgs, 'disputes'>
  >
  updateAction?: Resolver<
    ResolversTypes['Action'],
    ParentType,
    ContextType,
    RequireFields<MutationupdateActionArgs, 'action'>
  >
  updateActions?: Resolver<
    Array<Maybe<ResolversTypes['Action']>>,
    ParentType,
    ContextType,
    RequireFields<MutationupdateActionsArgs, 'action' | 'filter'>
  >
}

export type POIDisputeResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['POIDispute'] = ResolversParentTypes['POIDispute'],
> = {
  allocationAmount?: Resolver<ResolversTypes['BigInt'], ParentType, ContextType>
  allocationID?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  allocationIndexer?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  allocationProof?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  closedEpoch?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  closedEpochReferenceProof?: Resolver<
    Maybe<ResolversTypes['String']>,
    ParentType,
    ContextType
  >
  closedEpochStartBlockHash?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  closedEpochStartBlockNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  previousEpochReferenceProof?: Resolver<
    Maybe<ResolversTypes['String']>,
    ParentType,
    ContextType
  >
  previousEpochStartBlockHash?: Resolver<
    ResolversTypes['String'],
    ParentType,
    ContextType
  >
  previousEpochStartBlockNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  subgraphDeploymentID?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type QueryResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query'],
> = {
  action?: Resolver<
    Maybe<ResolversTypes['Action']>,
    ParentType,
    ContextType,
    RequireFields<QueryactionArgs, 'actionID'>
  >
  actions?: Resolver<
    Array<Maybe<ResolversTypes['Action']>>,
    ParentType,
    ContextType,
    Partial<QueryactionsArgs>
  >
  allocations?: Resolver<
    Array<ResolversTypes['Allocation']>,
    ParentType,
    ContextType,
    RequireFields<QueryallocationsArgs, 'filter'>
  >
  costModel?: Resolver<
    Maybe<ResolversTypes['CostModel']>,
    ParentType,
    ContextType,
    RequireFields<QuerycostModelArgs, 'deployment'>
  >
  costModels?: Resolver<
    Array<ResolversTypes['CostModel']>,
    ParentType,
    ContextType,
    Partial<QuerycostModelsArgs>
  >
  dispute?: Resolver<
    Maybe<ResolversTypes['POIDispute']>,
    ParentType,
    ContextType,
    RequireFields<QuerydisputeArgs, 'identifier'>
  >
  disputes?: Resolver<
    Array<Maybe<ResolversTypes['POIDispute']>>,
    ParentType,
    ContextType,
    RequireFields<QuerydisputesArgs, 'minClosedEpoch' | 'status'>
  >
  disputesClosedAfter?: Resolver<
    Array<Maybe<ResolversTypes['POIDispute']>>,
    ParentType,
    ContextType,
    RequireFields<QuerydisputesClosedAfterArgs, 'closedAfterBlock'>
  >
  indexerAllocations?: Resolver<
    Array<Maybe<ResolversTypes['IndexerAllocation']>>,
    ParentType,
    ContextType,
    RequireFields<QueryindexerAllocationsArgs, 'protocolNetwork'>
  >
  indexerDeployments?: Resolver<
    Array<Maybe<ResolversTypes['IndexerDeployment']>>,
    ParentType,
    ContextType
  >
  indexerEndpoints?: Resolver<
    Array<ResolversTypes['IndexerEndpoints']>,
    ParentType,
    ContextType,
    Partial<QueryindexerEndpointsArgs>
  >
  indexerRegistration?: Resolver<
    ResolversTypes['IndexerRegistration'],
    ParentType,
    ContextType,
    RequireFields<QueryindexerRegistrationArgs, 'protocolNetwork'>
  >
  indexingRule?: Resolver<
    Maybe<ResolversTypes['IndexingRule']>,
    ParentType,
    ContextType,
    RequireFields<QueryindexingRuleArgs, 'identifier' | 'merged'>
  >
  indexingRules?: Resolver<
    Array<ResolversTypes['IndexingRule']>,
    ParentType,
    ContextType,
    RequireFields<QueryindexingRulesArgs, 'merged'>
  >
}

export type ReallocateAllocationResultResolvers<
  ContextType = IndexerManagementResolverContext,
  ParentType extends
    ResolversParentTypes['ReallocateAllocationResult'] = ResolversParentTypes['ReallocateAllocationResult'],
> = {
  closedAllocation?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  createdAllocation?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  createdAllocationStake?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  indexingRewardsCollected?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  protocolNetwork?: Resolver<ResolversTypes['String'], ParentType, ContextType>
  receiptsWorthCollecting?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>
}

export type Resolvers<ContextType = IndexerManagementResolverContext> = {
  Action?: ActionResolvers<ContextType>
  ActionResult?: ActionResultResolvers<ContextType>
  Allocation?: AllocationResolvers<ContextType>
  BigInt?: GraphQLScalarType
  BlockPointer?: BlockPointerResolvers<ContextType>
  ChainIndexingStatus?: ChainIndexingStatusResolvers<ContextType>
  CloseAllocationResult?: CloseAllocationResultResolvers<ContextType>
  CostModel?: CostModelResolvers<ContextType>
  CreateAllocationResult?: CreateAllocationResultResolvers<ContextType>
  GeoLocation?: GeoLocationResolvers<ContextType>
  IndexerAllocation?: IndexerAllocationResolvers<ContextType>
  IndexerDeployment?: IndexerDeploymentResolvers<ContextType>
  IndexerEndpoint?: IndexerEndpointResolvers<ContextType>
  IndexerEndpointTest?: IndexerEndpointTestResolvers<ContextType>
  IndexerEndpoints?: IndexerEndpointsResolvers<ContextType>
  IndexerRegistration?: IndexerRegistrationResolvers<ContextType>
  IndexingError?: IndexingErrorResolvers<ContextType>
  IndexingRule?: IndexingRuleResolvers<ContextType>
  Mutation?: MutationResolvers<ContextType>
  POIDispute?: POIDisputeResolvers<ContextType>
  Query?: QueryResolvers<ContextType>
  ReallocateAllocationResult?: ReallocateAllocationResultResolvers<ContextType>
}
