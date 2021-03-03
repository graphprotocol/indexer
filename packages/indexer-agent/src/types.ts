import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import { BigNumber, providers } from 'ethers'
import { Network } from './network'
import { Client } from '@urql/core'

export interface AgentConfig {
  ethereum: providers.StaticJsonRpcProvider
  statusEndpoint: string
  adminEndpoint: string
  indexerManagement: IndexerManagementClient
  network: Network
  defaultAllocationAmount: BigNumber
  logger: Logger
  networkSubgraph: Client | SubgraphDeploymentID
  indexNodeIDs: string[]
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
}

export interface SubgraphDeployment {
  id: SubgraphDeploymentID
  stakedTokens: BigNumber
  signalAmount: BigNumber
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
