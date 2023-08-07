import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  Network,
  NetworkSubgraph,
  ReceiptCollector,
  GraphNode,
} from '@graphprotocol/indexer-common'
import { NetworkMonitor } from '@graphprotocol/indexer-common'

export interface AgentConfig {
  logger: Logger
  metrics: Metrics
  indexer: GraphNode
  network: Network
  networkMonitor: NetworkMonitor
  networkSubgraph: NetworkSubgraph
  allocateOnNetworkSubgraph: boolean
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector
}
