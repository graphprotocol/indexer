import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  Network,
  GraphNode,
  DeploymentManagementMode,
  IndexerManagementClient,
  Operator,
} from '@graphprotocol/indexer-common'

export interface AgentConfigs {
  logger: Logger
  metrics: Metrics
  graphNode: GraphNode
  operator: Operator
  indexerManagement: IndexerManagementClient
  network: Network
  deploymentManagement: DeploymentManagementMode
  offchainSubgraphs: SubgraphDeploymentID[]
  pollingInterval: number
}
