import { Logger } from '@graphprotocol/common-ts'
import {
  GraphNode,
  specification,
  SubgraphDeploymentAssignment,
  SubgraphStatus,
} from '@graphprotocol/indexer-common'
import { QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
  networkSpecifications: specification.NetworkSpecification[]
  graphNode: GraphNode
  nodeIds: string[]
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { logger, graphNode } = context
  logger.info(
    'Begin up migration: migrate subgraph deployment assignments to new pause mechanism',
  )

  const indexNodes = (await graphNode.indexNodes()).filter(
    (node: { id: string; deployments: Array<string> }) => {
      return node.id && node.id !== 'removed'
    },
  )
  logger.info('Index nodes', {
    indexNodes,
  })

  const targetNode =
    indexNodes.sort((nodeA, nodeB) => {
      return nodeA.deployments.length - nodeB.deployments.length
    })[0]?.id || 'default'

  const pausedDeploymentAssignments =
    await graphNode.subgraphDeploymentsAssignments(SubgraphStatus.PAUSED)

  const virtuallyPausedDeploymentAssignments =
    pausedDeploymentAssignments.filter(
      (assignment: SubgraphDeploymentAssignment) =>
        assignment.node === 'removed',
    )

  logger.info(
    'Reassigning paused subgraphs to valid node_id (targetNode), then pausing',
    {
      pausedSubgraphs: virtuallyPausedDeploymentAssignments.map(
        details => details.id,
      ),
      targetNode,
    },
  )

  for (const deploymentAssignment of virtuallyPausedDeploymentAssignments) {
    await graphNode.reassign(deploymentAssignment.id, targetNode)
    await graphNode.pause(deploymentAssignment.id)
    logger.debug('Successfully reassigned and paused deployment', {
      deployment: deploymentAssignment.id.ipfsHash,
    })
  }
}

export async function down({ context }: Context): Promise<void> {
  const { logger, graphNode } = context
  logger.info(
    'Begin down migration: revert to using virtual subgraph deployment pause mechanism',
  )

  const pausedDeploymentAssignments =
    await graphNode.subgraphDeploymentsAssignments(SubgraphStatus.PAUSED)

  logger.info(`Reassigning paused subgraphs to node_id = 'removed'`, {
    pausedSubgraphs: pausedDeploymentAssignments.map(details => details.id),
  })

  for (const deploymentAssignment of pausedDeploymentAssignments) {
    await graphNode.reassign(deploymentAssignment.id, 'removed')
    logger.debug(`Successfully reassigned deployment to node_id = 'removed'`, {
      deployment: deploymentAssignment.id.ipfsHash,
    })
  }
}
