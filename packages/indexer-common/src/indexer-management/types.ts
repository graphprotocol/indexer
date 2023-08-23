import { Address, SubgraphDeploymentID, toAddress } from '@tokene-q/common-ts'
import { BigNumber } from 'ethers'
import { Allocation } from '../allocations'
import { SubgraphDeployment } from '../types'

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

export interface NetworkEpoch {
  networkID: string
  epochNumber: number
  startBlockNumber: number
  startBlockHash: string
  latestBlock: number
}

export function epochElapsedBlocks(networkEpoch: NetworkEpoch): number {
  return networkEpoch.startBlockNumber - networkEpoch.latestBlock
}

const Caip2ByChainAlias: { [key: string]: string } = {
  // FIXME: This is a hack to make the indexer work with the current
  // Vitiya deployment. We should remove this once we have a proper chain
  mainnet: 'eip155:3243243243',
  goerli: 'eip155:5',
  gnosis: 'eip155:100',
  hardhat: 'eip155:1337',
  'arbitrum-one': 'eip155:42161',
  'arbitrum-goerli': 'eip155:421613',
  avalanche: 'eip155:43114',
  polygon: 'eip155:137',
  celo: 'eip155:42220',
  optimism: 'eip155:10',
  fantom: 'eip155:250',
  tokene: 'eip155:3243243243',
}

const Caip2ByChainId: { [key: number]: string } = {
  1: 'eip155:1',
  3243243243: 'eip155:3243243243',
  5: 'eip155:5',
  100: 'eip155:100',
  1337: 'eip155:1337',
  42161: 'eip155:42161',
  421613: 'eip155:421613',
  43114: 'eip155:43114',
  137: 'eip155:137',
  42220: 'eip155:42220',
  10: 'eip155:10',
  250: 'eip155:250',
}

/// Unified entrypoint to resolve CAIP ID based either on chain aliases (strings)
/// or chain ids (numbers).
export function resolveChainId(key: number | string): string {
  if (typeof key === 'number' || !isNaN(+key)) {
    // If key is a number, then it must be a `chainId`
    const chainId = Caip2ByChainId[+key]
    if (chainId !== undefined) {
      return chainId
    }
  } else {
    // If chain is a string, it must be a chain alias
    const chainId = Caip2ByChainAlias[key]
    if (chainId !== undefined) {
      return chainId
    }
  }
  throw new Error(`Failed to resolve CAIP2 ID from the provided network alias: ${key}`)
}

export function resolveChainAlias(id: string): string {
  const aliasMatches = Object.keys(Caip2ByChainAlias).filter(
    (name) => Caip2ByChainAlias[name] == id,
  )
  if (aliasMatches.length === 1) {
    return aliasMatches[0]
  } else if (aliasMatches.length === 0) {
    throw new Error(
      `Failed to match chain id, '${id}', to a network alias in Caip2ByChainAlias`,
    )
  } else {
    throw new Error(
      `Something has gone wrong, chain id, '${id}', matched more than one network alias in Caip2ByChainAlias`,
    )
  }
}
