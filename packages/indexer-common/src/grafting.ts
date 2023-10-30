import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { GraphNodeInterface } from './graph-node'
import {
  BlockPointer,
  LoggerInterface,
  SubgraphDeploymentDecision,
  SubgraphDeploymentDecisionKind,
  SubgraphManifest,
} from './types'
import { indexerError, IndexerErrorCode } from './errors'
import pMap from 'p-map'

// Any type that can return a SubgraphManifest when given a
// SubgraphDeploymentID as input.
export type SubgraphManifestResolver = (
  subgraphID: SubgraphDeploymentID,
) => Promise<SubgraphManifest>

// Syncing status obtained from Graph-Node.
interface IndexingStatus {
  latestBlock: BlockPointer | null
  health: string
}

// Naive grafting information: contains only the parent subgraph
// deployment and its block height.
export interface GraftBase {
  block: number
  deployment: SubgraphDeploymentID
}

// Naive lineage information for a subgraph, consisting of a target
// deployment and the series of its graft dependencies, in descending
// order.
export interface SubgraphLineage {
  target: SubgraphDeploymentID
  // list of descending graft bases (root is the last element).
  bases: GraftBase[]
}

// Graft base information enriched with indexing status obtained from
// Graph-Node.
interface GraftSubject extends GraftBase {
  // No indexing status implies undeployed subgraph.
  indexingStatus: IndexingStatus | null
}

// Subgraph lineage information enriched with indexing status for each
// graft dependency.
export interface SubgraphLineageWithStatus extends SubgraphLineage {
  bases: GraftSubject[]
}

export interface GraftBaseDeploymentDecision extends SubgraphDeploymentDecision {
  expectedBlockHeight: number
}

// Discovers all graft dependencies for a given subgraph.
export async function discoverLineage(
  subgraphManifestResolver: SubgraphManifestResolver,
  targetDeployment: SubgraphDeploymentID,
  maxIterations: number = 100,
): Promise<SubgraphLineage> {
  const graftBases: GraftBase[] = []
  let iterationCount = 0
  let foundRoot = false
  let currentDeployment = targetDeployment
  while (iterationCount < maxIterations) {
    const manifest = await subgraphManifestResolver(currentDeployment)
    let graft: GraftBase | null = null
    if (manifest.features?.includes('grafting') && manifest.graft) {
      // Found a graft base.
      const base = new SubgraphDeploymentID(manifest.graft.base)
      graft = { block: manifest.graft.block, deployment: base }
      graftBases.push(graft)
      currentDeployment = base
    } else {
      // Reached root subgraph, stop iterating.
      foundRoot = true
      break
    }
    iterationCount++
  }
  // Check if we have found the graft root.
  if (!foundRoot) {
    throw indexerError(
      IndexerErrorCode.IE075,
      `Failed to find the graft root for target subgraph deployment (${targetDeployment.ipfsHash}) after ${iterationCount} iterations.`,
    )
  }
  return { target: targetDeployment, bases: graftBases }
}

// Adds indexing status to a naive GraftBase.
export async function getIndexingStatus(
  graftBase: GraftBase,
  graphNode: GraphNodeInterface,
): Promise<GraftSubject> {
  let response
  try {
    response = await graphNode.indexingStatus([graftBase.deployment])
  } catch (error) {
    const message = `Failed to fetch indexing status when resolving subgraph grafts`
    throw indexerError(IndexerErrorCode.IE075, { message, error })
  }
  let indexingStatus: IndexingStatus | null = null
  if (response && response.length) {
    const subgraphIndexingStatus = response[0]
    let latestBlock: BlockPointer | null = null
    if (subgraphIndexingStatus.chains && subgraphIndexingStatus.chains.length) {
      latestBlock = subgraphIndexingStatus.chains[0].latestBlock
    }
    indexingStatus = {
      health: subgraphIndexingStatus.health,
      latestBlock,
    }
  }
  return { ...graftBase, indexingStatus }
}

export function determineSubgraphDeploymentDecisions(
  subgraphLineage: SubgraphLineageWithStatus,
): GraftBaseDeploymentDecision[] {
  const deploymentDecisions: GraftBaseDeploymentDecision[] = []

  // Check lineage size before making any assumptions.
  if (!subgraphLineage.bases.length) {
    throw indexerError(
      IndexerErrorCode.IE075,
      'Expected target subgraph to have at least one graft base.',
    )
  }
  // Check for undeployed and unsynced graft bases.

  // Iterate backwards, considering only bases that are essential for subgraph deployment.
  let earliestValidBaseIndex = subgraphLineage.bases.findIndex(
    (graft) => graft.indexingStatus && graft.indexingStatus.latestBlock,
  )
  const lastIndex = subgraphLineage.bases.length - 1
  earliestValidBaseIndex =
    earliestValidBaseIndex === -1 ? lastIndex : earliestValidBaseIndex

  for (let i = lastIndex; i >= 0; i--) {
    const graft = subgraphLineage.bases[i]
    const desiredBlockHeight = graft.block
    if (!graft.indexingStatus || !graft.indexingStatus.latestBlock) {
      // Ignore undeployed graft bases beyond the earliest valid one.
      if (i <= earliestValidBaseIndex) {
        // Graph Node is not aware of this subgraph deployment. We must deploy it and look no further.
        deploymentDecisions.push({
          deployment: graft.deployment,
          kind: SubgraphDeploymentDecisionKind.DEPLOY,
          expectedBlockHeight: graft.block,
        })
        break
      }
    } else {
      // Deployment exists.
      // Is it sufficiently synced?
      if (graft.indexingStatus.latestBlock.number >= desiredBlockHeight) {
        // If so, we can stop syncing it.
        deploymentDecisions.push({
          deployment: graft.deployment,
          kind: SubgraphDeploymentDecisionKind.REMOVE,
          expectedBlockHeight: graft.block,
        })
        continue
      }
      // Is it healthy?
      if (graft.indexingStatus.health !== 'healthy') {
        throw indexerError(IndexerErrorCode.IE075, {
          message: `Cannot deploy subgraph due to unhealthy graft base: ${graft.deployment.ipfsHash}`,
          graftDependencies: subgraphLineage,
        })
      }
    }
  }
  return deploymentDecisions
}

// Queries the Graph Node to get the deployment status of each graft base in the
// subgraph lineage.
export async function queryGraftBaseStatuses(
  subgraphLineage: SubgraphLineage,
  graphNode: GraphNodeInterface,
  parentLogger: LoggerInterface,
  concurrency: number = 5,
): Promise<SubgraphLineageWithStatus> {
  const logger = parentLogger.child({ function: 'queryGraftBaseStatuses' })
  logger.debug('Attempting to resolve graft bases for target subgraph')

  // Fetch deployment details for each graft base
  logger.debug('Querying Graph-Node for graft bases deployment status')
  const graftBasesDeploymentStatus = await pMap(
    subgraphLineage.bases,
    async (graftBase: GraftBase) => await getIndexingStatus(graftBase, graphNode),
    {
      stopOnError: true,
      concurrency,
    },
  )

  return {
    target: subgraphLineage.target,
    bases: graftBasesDeploymentStatus,
  }
}
