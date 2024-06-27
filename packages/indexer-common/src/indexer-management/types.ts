import {
  Address,
  Logger,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'
import { Allocation } from '../allocations'
import { GraphNode } from '../graph-node'
import { SubgraphDeployment } from '../types'

export interface CreateAllocationResult {
  actionID: number
  type: 'allocate'
  transactionID: string | undefined
  allocation: string
  deployment: string
  allocatedTokens: string
  protocolNetwork: string
}

export interface CloseAllocationResult {
  actionID: number
  type: 'unallocate'
  transactionID: string | undefined
  allocation: string
  allocatedTokens: string
  indexingRewards: string
  receiptsWorthCollecting: boolean
  protocolNetwork: string
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
  protocolNetwork: string
}

export interface ActionFailure {
  actionID: number
  transactionID?: string
  failureReason: string
  protocolNetwork: string
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
  protocolNetwork: string,
): SubgraphDeployment => ({
  id: new SubgraphDeploymentID(subgraphDeployment.id),
  deniedAt: subgraphDeployment.deniedAt,
  stakedTokens: BigNumber.from(subgraphDeployment.stakedTokens),
  signalledTokens: BigNumber.from(subgraphDeployment.signalledTokens),
  queryFeesAmount: BigNumber.from(subgraphDeployment.queryFeesAmount),
  protocolNetwork,
})

/* eslint-disable @typescript-eslint/no-explicit-any */
export const parseGraphQLAllocation = (
  allocation: any,
  protocolNetwork: string,
): Allocation => ({
  // Ensure the allocation ID (an address) is checksummed
  id: toAddress(allocation.id),
  status: allocation.status,
  subgraphDeployment: {
    id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
    deniedAt: allocation.subgraphDeployment.deniedAt,
    stakedTokens: BigNumber.from(allocation.subgraphDeployment.stakedTokens),
    signalledTokens: BigNumber.from(allocation.subgraphDeployment.signalledTokens),
    queryFeesAmount: BigNumber.from(allocation.subgraphDeployment.queryFeesAmount),
    protocolNetwork,
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

export const Caip2ByChainAlias: { [key: string]: string } = {
  mainnet: 'eip155:1',
  goerli: 'eip155:5',
  gnosis: 'eip155:100',
  hardhat: 'eip155:1337',
  'arbitrum-one': 'eip155:42161',
  'arbitrum-goerli': 'eip155:421613',
  'arbitrum-sepolia': 'eip155:421614',
  avalanche: 'eip155:43114',
  matic: 'eip155:137',
  celo: 'eip155:42220',
  optimism: 'eip155:10',
  fantom: 'eip155:250',
  sepolia: 'eip155:11155111',
}

export const Caip2ByChainId: { [key: number]: string } = {
  1: 'eip155:1',
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
  11155111: 'eip155:11155111',
  421614: 'eip155:421614',
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
  } else if (typeof key === 'string') {
    const splitKey = key.split(':')
    let chainId
    if (splitKey.length === 2) {
      chainId = Caip2ByChainId[+splitKey[1]]
    } else {
      chainId = Caip2ByChainAlias[key]
    }
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

// Compares the CAIP-2 chain ID between the Ethereum provider and the Network Subgraph and requires
// they are equal.
export async function validateProviderNetworkIdentifier(
  providerNetworkIdentifier: string,
  networkSubgraphDeploymentIpfsHash: string,
  graphNode: GraphNode,
  logger: Logger,
) {
  const subgraphNetworkId = new SubgraphDeploymentID(networkSubgraphDeploymentIpfsHash)
  const { network: subgraphNetworkChainName } =
    await graphNode.subgraphFeatures(subgraphNetworkId)

  if (!subgraphNetworkChainName) {
    // This is unlikely to happen because we expect that the Network Subgraph manifest is valid.
    const errorMsg = 'Failed to fetch the networkId for the Network Subgraph'
    logger.error(errorMsg, { networkSubgraphDeploymentIpfsHash })
    throw new Error(errorMsg)
  }

  const providerChainId = resolveChainId(providerNetworkIdentifier)
  const networkSubgraphChainId = resolveChainId(subgraphNetworkChainName)
  if (providerChainId !== networkSubgraphChainId) {
    const errorMsg =
      'The configured provider and the Network Subgraph have different CAIP-2 chain IDs. ' +
      'Please ensure that both Network Subgraph and the Ethereum provider are correctly configured.'
    logger.error(errorMsg, {
      networkSubgraphDeploymentIpfsHash,
      networkSubgraphChainId,
      providerChainId,
    })
    throw new Error(errorMsg)
  }
}

// Convenience function to check if a given network identifier is a supported Layer-1 protocol network
export function networkIsL1(networkIdentifier: string): boolean {
  // Normalize network identifier
  networkIdentifier = resolveChainId(networkIdentifier)
  return networkIdentifier === 'eip155:1' || networkIdentifier === 'eip155:11155111'
}

// Convenience function to check if a given network identifier is a supported Layer-2 protocol network
export function networkIsL2(networkIdentifier: string): boolean {
  // Normalize network identifier
  networkIdentifier = resolveChainId(networkIdentifier)
  return networkIdentifier === 'eip155:42161' || networkIdentifier === 'eip155:421614'
}
