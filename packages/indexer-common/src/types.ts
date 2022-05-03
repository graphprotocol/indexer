import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber, providers } from 'ethers'

export enum AllocationManagementMode {
  AUTO = 'auto',
  MANUAL = 'manual',
  OVERSIGHT = 'oversight',
}

export interface BlockPointer {
  number: number
  hash: string
}

export interface EthereumIndexingStatus {
  network: string
  latestBlock: BlockPointer
  chainHeadBlock: BlockPointer
  earliestBlock: BlockPointer | null
}

export type ChainIndexingStatus = EthereumIndexingStatus

export interface IndexingStatus {
  subgraphDeployment: SubgraphDeploymentID
  health: string
  synced: boolean
  fatalError: IndexingError
  node: string
  chains: ChainIndexingStatus[]
}

export interface IndexingError {
  handler: string
  message: string
}

export interface SubgraphVersion {
  version: number
  createdAt: number
  deployment: SubgraphDeploymentID
}

export interface Subgraph {
  id: string
  versionCount: number
  versions: SubgraphVersion[]
}

export enum TransactionType {
  ZERO,
  TWO,
}

export interface TransactionConfig extends providers.TransactionRequest {
  attempt: number
  gasBump: BigNumber
  type: TransactionType
}
