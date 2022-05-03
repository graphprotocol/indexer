import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  AllocationManagementMode,
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
  allocationManagementMode: AllocationManagementMode
}
