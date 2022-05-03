/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Address, SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

export interface SubgraphDeployment {
  id: SubgraphDeploymentID
  deniedAt: number
  stakedTokens: BigNumber
  signalledTokens: BigNumber
  queryFeesAmount: BigNumber
  activeAllocations: number
}

export interface Allocation {
  id: Address
  status: AllocationStatus
  subgraphDeployment: SubgraphDeployment
  indexer: Address
  allocatedTokens: BigNumber
  createdAtEpoch: number
  createdAtBlockHash: string
  closedAtEpoch: number
  closedAtEpochStartBlockHash: string | undefined
  previousEpochStartBlockHash: string | undefined
  closedAtBlockHash: string
  poi: string | undefined
  queryFeeRebates: BigNumber | undefined
  queryFeesCollected: BigNumber | undefined
}

export enum AllocationStatus {
  NULL = 'Null',
  ACTIVE = 'Active',
  CLOSED = 'Closed',
  FINALIZED = 'Finalized',
  CLAIMED = 'Claimed',
}

export interface CreateAllocationResult {
  actionID: number
  type: 'allocate'
  transactionID: string | undefined
  allocation: string
  deployment: string
  allocatedTokens: string
}

export interface CloseAllocationResult {
  actionID: number
  type: 'unallocate'
  transactionID: string | undefined
  allocation: string
  allocatedTokens: string
  indexingRewards: string
  receiptsWorthCollecting: boolean
}

export interface ReallocateAllocationResult {
  actionID: number
  type: 'reallocate'
  transactionID: string | undefined
  closedAllocation: string
  indexingRewardsCollected: string
  receiptsWorthCollecting: boolean
  createdAllocation: string
  createdAllocationStake: string
}

export interface ActionFailure {
  actionID: number
  transactionID?: string
  failureReason: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const isActionFailure = (variableToCheck: any): variableToCheck is ActionFailure =>
  'failureReason' in variableToCheck

export type AllocationResult =
  | CreateAllocationResult
  | CloseAllocationResult
  | ReallocateAllocationResult
  | ActionFailure

/* eslint-disable @typescript-eslint/no-explicit-any */
export const parseGraphQLSubgraphDeployment = (
  subgraphDeployment: any,
): SubgraphDeployment => ({
  id: new SubgraphDeploymentID(subgraphDeployment.id),
  deniedAt: subgraphDeployment.deniedAt,
  stakedTokens: BigNumber.from(subgraphDeployment.stakedTokens),
  signalledTokens: BigNumber.from(subgraphDeployment.signalledTokens),
  queryFeesAmount: BigNumber.from(subgraphDeployment.queryFeesAmount),
  activeAllocations: subgraphDeployment.indexerAllocations.length,
})

/* eslint-disable @typescript-eslint/no-explicit-any */
export const parseGraphQLAllocation = (allocation: any): Allocation => ({
  // Ensure the allocation ID (an address) is checksummed
  id: toAddress(allocation.id),
  status: allocation.status,
  subgraphDeployment: {
    id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
    deniedAt: allocation.subgraphDeployment.deniedAt,
    stakedTokens: BigNumber.from(allocation.subgraphDeployment.stakedTokens),
    signalledTokens: BigNumber.from(allocation.subgraphDeployment.signalledTokens),
    queryFeesAmount: BigNumber.from(allocation.subgraphDeployment.queryFeesAmount),
    activeAllocations: allocation.subgraphDeployment.indexerAllocations
      ? allocation.subgraphDeployment.indexerAllocations.length
      : 0,
  },
  indexer: toAddress(allocation.indexer.id),
  allocatedTokens: BigNumber.from(allocation.allocatedTokens),
  createdAtBlockHash: allocation.createdAtBlockHash,
  createdAtEpoch: allocation.createdAtEpoch,
  closedAtEpoch: allocation.closedAtEpoch,
  closedAtEpochStartBlockHash: undefined,
  previousEpochStartBlockHash: undefined,
  closedAtBlockHash: allocation.closedAtBlockHash,
  poi: allocation.poi,
  queryFeeRebates: allocation.queryFeeRebates,
  queryFeesCollected: allocation.queryFeesCollected,
})

export interface RewardsPool {
  subgraphDeployment: SubgraphDeploymentID
  allocationIndexer: Address
  allocationCreatedAtBlockHash: string
  closedAtEpoch: number
  closedAtEpochStartBlockHash: string | undefined
  closedAtEpochStartBlockNumber: number | undefined
  previousEpochStartBlockHash: string | undefined
  previousEpochStartBlockNumber: number | undefined
  referencePOI: string | undefined
  referencePreviousPOI: string | undefined
}

export const allocationRewardsPool = (allocation: Allocation): RewardsPool => ({
  subgraphDeployment: allocation.subgraphDeployment.id,
  allocationIndexer: allocation.indexer,
  allocationCreatedAtBlockHash: allocation.createdAtBlockHash,
  closedAtEpoch: allocation.closedAtEpoch,
  closedAtEpochStartBlockHash: allocation.closedAtEpochStartBlockHash,
  closedAtEpochStartBlockNumber: undefined,
  previousEpochStartBlockHash: allocation.previousEpochStartBlockHash,
  previousEpochStartBlockNumber: undefined,
  referencePOI: undefined,
  referencePreviousPOI: undefined,
})

export interface Epoch {
  id: number
  startBlock: number
  startBlockHash: string | undefined
  endBlock: number
  signalledTokens: number
  stakeDeposited: number
  queryFeeRebates: number
  totalRewards: number
  totalIndexerRewards: number
  totalDelegatorRewards: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const parseGraphQLEpochs = (epoch: any): Epoch => ({
  id: epoch.id,
  startBlock: epoch.startBlock,
  startBlockHash: undefined,
  endBlock: epoch.endBlock,
  signalledTokens: epoch.signalledTokens,
  stakeDeposited: epoch.stakeDeposited,
  queryFeeRebates: epoch.queryFeeRebates,
  totalRewards: epoch.totalRewards,
  totalIndexerRewards: epoch.totalIndexerRewards,
  totalDelegatorRewards: epoch.totalDelegatorRewards,
})
