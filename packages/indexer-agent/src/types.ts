import { Logger, Metrics, SubgraphDeploymentID } from '@tokene-q/common-ts'
import {
  Network,
  NetworkSubgraph,
  ReceiptCollector,
} from '@graphprotocol/indexer-common'
import { Indexer } from './indexer'
import { NetworkMonitor } from '@graphprotocol/indexer-common'

export interface AgentConfig {
  logger: Logger
  metrics: Metrics
  indexer: Indexer
  network: Network
  networkMonitor: NetworkMonitor
  networkSubgraph: NetworkSubgraph
  allocateOnNetworkSubgraph: boolean
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector
}
