import {
  Logger,
  SubgraphDeploymentID,
  IndexerManagementClient,
} from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'
import { Network } from './network'

export interface AgentConfig {
  statusEndpoint: string
  adminEndpoint: string
  indexerManagement: IndexerManagementClient
  network: Network
  defaultAllocationAmount: BigNumber
  logger: Logger
  networkSubgraphDeployment: SubgraphDeploymentID
  indexNodeIDs: string[]
}

export interface SubgraphDeployment {
  id: SubgraphDeploymentID
  stakedTokens: BigNumber
  signalAmount: BigNumber
}

export interface Allocation {
  id: string
  subgraphDeployment: SubgraphDeployment
  allocatedTokens: BigNumber
  createdAtEpoch: number
}

export interface EthereumBlock {
  number: number
  hash: string
}

export interface EthereumIndexingStatus {
  network: string
  latestBlock: EthereumBlock
  chainHeadBlock: EthereumBlock
}

export type ChainIndexingStatus = EthereumIndexingStatus

export interface IndexingStatus {
  subgraphDeployment: SubgraphDeploymentID
  health: string
  synced: boolean
  fatalError: IndexingError
  chains: ChainIndexingStatus[]
}

export interface IndexingError {
  handler: string
  message: string
}
