import { Address, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber, providers } from 'ethers'

export enum AllocationManagementMode {
  AUTO = 'auto',
  MANUAL = 'manual',
  OVERSIGHT = 'oversight',
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
  stakedTokens: BigNumber
  signalledTokens: BigNumber
  queryFeesAmount: BigNumber
  activeAllocations: number
  name?: string
  creatorAddress?: Address
}

export function formatDeploymentName(subgraphDeployment: SubgraphDeployment): string {
  const creatorAddress = subgraphDeployment.creatorAddress || 'unknownCreator'
  const cleanedName = cleanDeploymentName(subgraphDeployment.name)
  return `${cleanedName}/${subgraphDeployment.id.ipfsHash}/${creatorAddress}`
}

export function cleanDeploymentName(subgraphName: undefined | string): string {
  const unknownSubgraph = 'unknownSubgraph'

  if (!subgraphName) {
    return unknownSubgraph
  }

  /* Strip everything out of the string except for ASCII alphanumeric characters, dashes and
   underscores.

   We must also limit the name size, as Graph Node enforces a maximum deployment name lenght of 255
   characters. Considering the other parts of the deployment name have fixed sizes (see table
   below), we must limit the subgraph name to 165 characters.

   ------------------+-----
    Subgraph Name    | 165  <--- Size Limit
    Slash            |   1
    IPFS Qm-Hash     |  46
    Slash            |   1
    Owner Address    |  42
   ------------------+-----
    Total Characters | 255
   ------------------+----- */
  let cleaned = subgraphName.replace(/[^\w\d_-]+/g, '').slice(0, 165)

  // 1. Should not start or end with a special character.
  const first = cleaned.match(/^[-_]/) ? 1 : undefined
  const last = cleaned.slice(-1).match(/[-_]$/) ? cleaned.length - 1 : undefined
  cleaned = cleaned.slice(first, last)

  // 2. Must be non-empty.
  if (cleaned === '') {
    return unknownSubgraph
  }

  // 3. To keep URLs unambiguous, reserve the token "graphql".
  if (cleaned == 'graphql') {
    return 'graphql-subgraph'
  }

  return cleaned
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
