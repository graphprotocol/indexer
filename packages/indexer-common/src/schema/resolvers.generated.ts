/* This file was automatically generated. DO NOT UPDATE MANUALLY. */
import type { Resolvers } from './types.generated'
import { Action } from './indexer-management/resolvers/Action'
import { ActionResult } from './indexer-management/resolvers/ActionResult'
import { Allocation } from './indexer-management/resolvers/Allocation'
import { BigInt } from './indexer-management/resolvers/BigInt'
import { BlockPointer } from './indexer-management/resolvers/BlockPointer'
import { ChainIndexingStatus } from './indexer-management/resolvers/ChainIndexingStatus'
import { CloseAllocationResult } from './indexer-management/resolvers/CloseAllocationResult'
import { CostModel } from './indexer-management/resolvers/CostModel'
import { CreateAllocationResult } from './indexer-management/resolvers/CreateAllocationResult'
import { GeoLocation } from './indexer-management/resolvers/GeoLocation'
import { IndexerAllocation } from './indexer-management/resolvers/IndexerAllocation'
import { IndexerDeployment } from './indexer-management/resolvers/IndexerDeployment'
import { IndexerEndpoint } from './indexer-management/resolvers/IndexerEndpoint'
import { IndexerEndpointTest } from './indexer-management/resolvers/IndexerEndpointTest'
import { IndexerEndpoints } from './indexer-management/resolvers/IndexerEndpoints'
import { IndexerRegistration } from './indexer-management/resolvers/IndexerRegistration'
import { IndexingError } from './indexer-management/resolvers/IndexingError'
import { IndexingRule } from './indexer-management/resolvers/IndexingRule'
import { approveActions as Mutation_approveActions } from './indexer-management/resolvers/Mutation/approveActions'
import { cancelActions as Mutation_cancelActions } from './indexer-management/resolvers/Mutation/cancelActions'
import { closeAllocation as Mutation_closeAllocation } from './indexer-management/resolvers/Mutation/closeAllocation'
import { createAllocation as Mutation_createAllocation } from './indexer-management/resolvers/Mutation/createAllocation'
import { deleteActions as Mutation_deleteActions } from './indexer-management/resolvers/Mutation/deleteActions'
import { deleteCostModels as Mutation_deleteCostModels } from './indexer-management/resolvers/Mutation/deleteCostModels'
import { deleteDisputes as Mutation_deleteDisputes } from './indexer-management/resolvers/Mutation/deleteDisputes'
import { deleteIndexingRule as Mutation_deleteIndexingRule } from './indexer-management/resolvers/Mutation/deleteIndexingRule'
import { deleteIndexingRules as Mutation_deleteIndexingRules } from './indexer-management/resolvers/Mutation/deleteIndexingRules'
import { executeApprovedActions as Mutation_executeApprovedActions } from './indexer-management/resolvers/Mutation/executeApprovedActions'
import { queueActions as Mutation_queueActions } from './indexer-management/resolvers/Mutation/queueActions'
import { reallocateAllocation as Mutation_reallocateAllocation } from './indexer-management/resolvers/Mutation/reallocateAllocation'
import { setCostModel as Mutation_setCostModel } from './indexer-management/resolvers/Mutation/setCostModel'
import { setIndexingRule as Mutation_setIndexingRule } from './indexer-management/resolvers/Mutation/setIndexingRule'
import { storeDisputes as Mutation_storeDisputes } from './indexer-management/resolvers/Mutation/storeDisputes'
import { updateAction as Mutation_updateAction } from './indexer-management/resolvers/Mutation/updateAction'
import { updateActions as Mutation_updateActions } from './indexer-management/resolvers/Mutation/updateActions'
import { POIDispute } from './indexer-management/resolvers/POIDispute'
import { action as Query_action } from './indexer-management/resolvers/Query/action'
import { actions as Query_actions } from './indexer-management/resolvers/Query/actions'
import { allocations as Query_allocations } from './indexer-management/resolvers/Query/allocations'
import { costModel as Query_costModel } from './indexer-management/resolvers/Query/costModel'
import { costModels as Query_costModels } from './indexer-management/resolvers/Query/costModels'
import { dispute as Query_dispute } from './indexer-management/resolvers/Query/dispute'
import { disputes as Query_disputes } from './indexer-management/resolvers/Query/disputes'
import { disputesClosedAfter as Query_disputesClosedAfter } from './indexer-management/resolvers/Query/disputesClosedAfter'
import { indexerAllocations as Query_indexerAllocations } from './indexer-management/resolvers/Query/indexerAllocations'
import { indexerDeployments as Query_indexerDeployments } from './indexer-management/resolvers/Query/indexerDeployments'
import { indexerEndpoints as Query_indexerEndpoints } from './indexer-management/resolvers/Query/indexerEndpoints'
import { indexerRegistration as Query_indexerRegistration } from './indexer-management/resolvers/Query/indexerRegistration'
import { indexingRule as Query_indexingRule } from './indexer-management/resolvers/Query/indexingRule'
import { indexingRules as Query_indexingRules } from './indexer-management/resolvers/Query/indexingRules'
import { ReallocateAllocationResult } from './indexer-management/resolvers/ReallocateAllocationResult'
export const resolvers: Resolvers = {
  Query: {
    action: Query_action,
    actions: Query_actions,
    allocations: Query_allocations,
    costModel: Query_costModel,
    costModels: Query_costModels,
    dispute: Query_dispute,
    disputes: Query_disputes,
    disputesClosedAfter: Query_disputesClosedAfter,
    indexerAllocations: Query_indexerAllocations,
    indexerDeployments: Query_indexerDeployments,
    indexerEndpoints: Query_indexerEndpoints,
    indexerRegistration: Query_indexerRegistration,
    indexingRule: Query_indexingRule,
    indexingRules: Query_indexingRules,
  },
  Mutation: {
    approveActions: Mutation_approveActions,
    cancelActions: Mutation_cancelActions,
    closeAllocation: Mutation_closeAllocation,
    createAllocation: Mutation_createAllocation,
    deleteActions: Mutation_deleteActions,
    deleteCostModels: Mutation_deleteCostModels,
    deleteDisputes: Mutation_deleteDisputes,
    deleteIndexingRule: Mutation_deleteIndexingRule,
    deleteIndexingRules: Mutation_deleteIndexingRules,
    executeApprovedActions: Mutation_executeApprovedActions,
    queueActions: Mutation_queueActions,
    reallocateAllocation: Mutation_reallocateAllocation,
    setCostModel: Mutation_setCostModel,
    setIndexingRule: Mutation_setIndexingRule,
    storeDisputes: Mutation_storeDisputes,
    updateAction: Mutation_updateAction,
    updateActions: Mutation_updateActions,
  },

  Action: Action,
  ActionResult: ActionResult,
  Allocation: Allocation,
  BigInt: BigInt,
  BlockPointer: BlockPointer,
  ChainIndexingStatus: ChainIndexingStatus,
  CloseAllocationResult: CloseAllocationResult,
  CostModel: CostModel,
  CreateAllocationResult: CreateAllocationResult,
  GeoLocation: GeoLocation,
  IndexerAllocation: IndexerAllocation,
  IndexerDeployment: IndexerDeployment,
  IndexerEndpoint: IndexerEndpoint,
  IndexerEndpointTest: IndexerEndpointTest,
  IndexerEndpoints: IndexerEndpoints,
  IndexerRegistration: IndexerRegistration,
  IndexingError: IndexingError,
  IndexingRule: IndexingRule,
  POIDispute: POIDispute,
  ReallocateAllocationResult: ReallocateAllocationResult,
}
