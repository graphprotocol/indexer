import { Logger } from '@graphprotocol/common-ts'
import {
  formatDeploymentName,
  indexerError,
  IndexerErrorCode,
  IndexingStatusResolver,
  NetworkMonitor,
  SubgraphDeploymentAssignment,
} from '@graphprotocol/indexer-common'
import { Client } from 'jayson/promise'
import pMap, { pMapSkip } from 'p-map'

interface MigrationContext {
  logger: Logger
  indexingStatusResolver: IndexingStatusResolver
  graphNodeAdminEndpoint: string
  networkMonitor: NetworkMonitor
}

interface Context {
  context: MigrationContext
}

interface SubgraphRedeployment {
  newName: string
  ipfsHash: string
  nodeId: string
}

export async function up({ context }: Context): Promise<void> {
  const { logger, networkMonitor: networkMonitor } = context

  const clientConstructor = context.graphNodeAdminEndpoint.startsWith('https')
    ? Client.https
    : Client.http
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = clientConstructor(context.graphNodeAdminEndpoint as any)

  // Fetch active deployments.
  const subgraphDeploymentAssignments =
    await context.indexingStatusResolver.subgraphDeploymentsAssignments()

  // Maps assignments to redeployments
  const mapper = async (assignment: SubgraphDeploymentAssignment) =>
    await processAssignment(assignment, networkMonitor, logger)

  // Produces the Redeployments.
  const subgraphRedeployments: SubgraphRedeployment[] = (
    await pMap(subgraphDeploymentAssignments, mapper)
  ).filter((item): item is SubgraphRedeployment => Boolean(item))

  // Execute Redeployments over Graph-Node's RPC endpoint
  pMap(
    subgraphRedeployments,
    async subgraphRedeployment => redeploy(rpc, subgraphRedeployment, logger),
    { concurrency: 10 },
  )
}

export async function down(): Promise<void> {
  // Nothing to do here. The old subgraph names should still exist in Graph Node's database.
}

// Performs redeployment in Graph-Node
async function redeploy(
  client: Client,
  subgraphRedeployment: SubgraphRedeployment,
  logger: Logger,
): Promise<void | typeof pMapSkip> {
  logger = logger.child({
    ...subgraphRedeployment,
  })
  try {
    logger.info(`Redeploying subgraph with adjusted name`)
    logger.debug(`Sending subgraph_create request`)
    const create_response = await client.request('subgraph_create', {
      name: subgraphRedeployment.newName,
    })
    if (create_response.error) {
      throw create_response.error
    }
    logger.debug(`Sending subgraph_deploy request`)
    const deploy_response = await client.request('subgraph_deploy', {
      name: subgraphRedeployment.newName,
      ipfs_hash: subgraphRedeployment.ipfsHash,
      node_id: subgraphRedeployment.nodeId,
    })
    if (deploy_response.error) {
      throw deploy_response.error
    }
    logger.info(`Successfully redeployed subgraph with a fixed name`)
  } catch (error) {
    const err = indexerError(IndexerErrorCode.IE026, error)
    logger.warn(
      `Failed to redeploy subgraph with a fixed name. Skipping its rename`,
      { err },
    )
    return pMapSkip
  }
}

// Tentatively converts a `SubgraphDeploymentAssignment` into a `SubgraphRedeployment`
async function processAssignment(
  assignment: SubgraphDeploymentAssignment,
  networkMonitor: NetworkMonitor,
  logger: Logger,
): Promise<SubgraphRedeployment | undefined> {
  logger.debug(
    `Querying the Network Subgraph for more details on subgraph deployment ${assignment.id}`,
  )
  const deployment = await networkMonitor.subgraphDeployment(
    assignment.id.ipfsHash,
  )
  if (!deployment) {
    logger.info(
      `Subgraph deployment ${assignment.id} was not found in Network Subgraph. Skipping its redeployment`,
    )
    return undefined
  }
  return {
    newName: formatDeploymentName(deployment),
    ipfsHash: assignment.id.ipfsHash,
    nodeId: assignment.node,
  }
}
