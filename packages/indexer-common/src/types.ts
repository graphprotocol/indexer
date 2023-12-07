import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber, providers, Contract } from 'ethers'

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
  stakedTokens: BigNumber
  signalledTokens: BigNumber
  queryFeesAmount: BigNumber
  protocolNetwork: string
}

// L1 Network Subgraph will always return `null` for the
// `transferredToL2*` set of fields
export interface TransferredSubgraphDeployment {
  id: string
  idOnL1: string
  idOnL2: string
  startedTransferToL2L: boolean
  startedTransferToL2At: BigNumber
  startedTransferToL2AtBlockNumber: BigNumber
  startedTransferToL2AtTx: string
  transferredToL2: boolean | null
  transferredToL2At: BigNumber | null
  transferredToL2AtTx: string | null
  transferredToL2AtBlockNumber: BigNumber | null
  ipfsHash: string
  protocolNetwork: string
  ready: boolean | null
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

export type EscrowContract = Contract | null

export async function getEscrowContract(
  networkIdentifier: string,
  networkProvider: providers.StaticJsonRpcProvider,
): Promise<EscrowContract> {
  // Escrow ONLY available at arb-sepolia (chain id: eip155:421614)
  if (networkIdentifier === 'eip155:421614') {
    const contractAddress = '0x1e4dC4f9F95E102635D8F7ED71c5CdbFa20e2d02'
    try {
      //Dependency doesn't provide better import methods
      const response = await fetch(
        'https://github.com/semiotic-ai/timeline-aggregation-protocol-subgraph/blob/main/abis/Escrow.abi.json',
      )
      const abi = await response.json()
      return new Contract(contractAddress, abi, networkProvider)
    } catch (error) {
      console.error(error)
      return null
    }
  } else {
    return null
  }
}
