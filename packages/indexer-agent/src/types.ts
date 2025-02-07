import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  Network,
  GraphNode,
  DeploymentManagementMode,
  IndexerManagementClient,
  Operator,
} from '@graphprotocol/indexer-common'

// Represents a pair of Network and Operator instances belonging to the same protocol
// network. Used when mapping over multiple protocol networks.
export type NetworkAndOperator = {
  network: Network
  operator: Operator
}

export interface AgentConfigs {
  logger: Logger
  metrics: Metrics
  graphNode: GraphNode
  network: Network
  operator: Operator
  indexerManagement: IndexerManagementClient
  deploymentManagement: DeploymentManagementMode
  autoMigrationSupport: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  pollingInterval: number
}
