import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Network } from './network'
import { ReceiptCollector } from './query-fees'
import { Indexer } from './indexer'
import { NetworkSubgraph } from './network-subgraph'

export interface AgentConfig {
  logger: Logger
  metrics: Metrics
  indexer: Indexer
  network: Network
  networkSubgraph: NetworkSubgraph
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector
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
