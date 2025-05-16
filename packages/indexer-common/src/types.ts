import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { TransactionRequest } from 'ethers'

export enum AllocationManagementMode {
  AUTO = 'auto',
  MANUAL = 'manual',
  OVERSIGHT = 'oversight',
}

export enum DeploymentManagementMode {
  AUTO = 'auto',
  MANUAL = 'manual',
}

export enum OrderDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export interface BlockPointer {
  number: number
  hash: string
}

export interface EthereumIndexingStatus {
  network: string
  latestBlock: BlockPointer | null
  chainHeadBlock: BlockPointer | null
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

export interface SubgraphDeployment {
  id: SubgraphDeploymentID
  deniedAt: number
  stakedTokens: bigint
  signalledTokens: bigint
  queryFeesAmount: bigint
  protocolNetwork: string
}

// L1 Network Subgraph will always return `null` for the
// `transferredToL2*` set of fields
export interface TransferredSubgraphDeployment {
  id: string
  idOnL1: string
  idOnL2: string
  startedTransferToL2L: boolean
  startedTransferToL2At: bigint
  startedTransferToL2AtBlockNumber: bigint
  startedTransferToL2AtTx: string
  transferredToL2: boolean | null
  transferredToL2At: bigint | null
  transferredToL2AtTx: string | null
  transferredToL2AtBlockNumber: bigint | null
  ipfsHash: string
  protocolNetwork: string
  ready: boolean | null
}

export enum TransactionType {
  ZERO,
  TWO,
}

export interface TransactionConfig extends TransactionRequest {
  attempt: number
  gasBump: bigint
  type: TransactionType
}

export function parseDeploymentManagementMode(input: string): DeploymentManagementMode {
  switch (input) {
    case DeploymentManagementMode.AUTO:
      return DeploymentManagementMode.AUTO
    case DeploymentManagementMode.MANUAL:
      return DeploymentManagementMode.MANUAL
    default:
      throw new Error(`Invalid value for deployment management mode: ${input}`)
  }
}
