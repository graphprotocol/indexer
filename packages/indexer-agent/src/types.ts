import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  Network,
  NetworkSubgraph,
  ReceiptCollector,
} from '@graphprotocol/indexer-common'
import { Indexer } from './indexer'

export enum AllocationManagementMode {
  AUTO,
  MANUAL,
}

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
  allocationManagementMode: AllocationManagementMode
}
