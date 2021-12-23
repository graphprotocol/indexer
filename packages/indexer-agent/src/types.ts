import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { NetworkSubgraph } from '@graphprotocol/indexer-common'
import { Network } from './network'
import { Indexer } from './indexer'
import { ReceiptCollector } from './query-fees'

export interface AgentConfig {
  logger: Logger
  metrics: Metrics
  indexer: Indexer
  network: Network
  networkSubgraph: NetworkSubgraph
  allocateOnNetworkSubgraph: boolean
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector
}
