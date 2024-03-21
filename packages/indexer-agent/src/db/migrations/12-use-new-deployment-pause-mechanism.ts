import { Logger } from '@graphprotocol/common-ts'
import {
  GraphNode,
  specification,
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
  const { logger, graphNode, nodeIds } = context
  logger.info(
    'Begin up migration: migrate subgraph deployment assignments to new pause mechanism',
  )

  if (nodeIds.length < 1) {
    throw new Error(
      `Migration 12 needs at least one value in the 'indexNodeIds' startup parameter` +
        `Please restart the indexer-agent with at least one 'indexNodeIds' value supplied`,
    )
  }

  const indexNodes = (await graphNode.indexNodes()).filter(
    (node: { id: string; deployments: Array<string> }) => {
      return node.id && node.id !== 'removed'
    },
  )
  const usedIndexNodeIDs = indexNodes.map(node => node.id)
  const unusedNodes = nodeIds.filter(nodeID => !(nodeID in usedIndexNodeIDs))

  const targetNode = unusedNodes
    ? unusedNodes[Math.floor(Math.random() * unusedNodes.length)]
    : indexNodes.sort((nodeA, nodeB) => {
        return nodeA.deployments.length - nodeB.deployments.length
      })[0].id

  const virtuallyPausedDeploymentAssignments =
    await graphNode.subgraphDeploymentsAssignments(SubgraphStatus.PAUSED)

  logger.info(
    'Reassigning paused subgraphs to valid node_id (tagetNode), then pausing',
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
