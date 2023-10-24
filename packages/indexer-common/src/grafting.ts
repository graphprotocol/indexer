import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { GraphNodeInterface } from './graph-node'
import {
  BlockPointer,
  SubgraphDeploymentDecision,
  SubgraphDeploymentDecisionKind,
  SubgraphManifest,
} from './types'
import { indexerError, IndexerErrorCode } from './errors'

type SubgraphManifestResolver = (
  subgraphID: SubgraphDeploymentID,
) => Promise<SubgraphManifest>

interface IndexingStatus {
  latestBlock: BlockPointer | null
  health: string
  synced: boolean
}

export interface GraftBase {
  block: number
  base: SubgraphDeploymentID
}

export interface GraftableSubgraph {
  deployment: SubgraphDeploymentID
  graft: GraftBase | null // Root subgraph does not have a graft base
}

interface GraftableSubgraphStatus extends GraftableSubgraph {
  indexingStatus: IndexingStatus | null
}

// TODO: use this type instead of a plain list.
// Benefits: No need to check for graft base block on the adjacent sibling.
interface SubgraphGraftLineage {
  target: SubgraphDeploymentID
  root: GraftBase
  // list of descending graft bases, except the root.
  bases: GraftBase[]
}

// Discovers all graft dependencies for a given subgraph
export async function discoverGraftBases(
  subgraphManifestResolver: SubgraphManifestResolver,
  targetDeployment: SubgraphDeploymentID,
  maxIterations: number = 100,
): Promise<GraftableSubgraph[]> {
  const graftBases: GraftableSubgraph[] = []
  let iterationCount = 0
  let deployment = targetDeployment
  while (iterationCount < maxIterations) {
    const manifest = await subgraphManifestResolver(deployment)
    let graft: GraftBase | null = null
    if (manifest.features?.includes('grafting') && manifest.graft) {
      // Found a graft base
      const base = new SubgraphDeploymentID(manifest.graft.base)
      graft = { block: manifest.graft.block, base }
      graftBases.push({ deployment, graft })
      deployment = base
    } else {
      // Reached root subgraph, stop iterating
      iterationCount = maxIterations
      graftBases.push({ deployment, graft })
    }
    iterationCount++
  }
  // Check if we have found the graft root
  if (graftBases.length > 0 && graftBases[graftBases.length - 1].graft !== null) {
    throw new Error(
      `Failed to find a graft root for target subgraph deployment (${targetDeployment.ipfsHash}) after ${iterationCount} iterations.`,
    )
  }
  return graftBases
}

export async function getIndexingStatusOfGraftableSubgraph(
  subgraph: GraftableSubgraph,
  graphNode: GraphNodeInterface,
): Promise<GraftableSubgraphStatus> {
  let response
  try {
    response = await graphNode.indexingStatus([subgraph.deployment])
  } catch (error) {
    const message = `Failed to fetch indexing status when resolving subgraph grafts`
    // TODO: log this error
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
      synced: subgraphIndexingStatus.synced,
      latestBlock,
    }
  }
  return { ...subgraph, indexingStatus }
}

export function resolveGraftedSubgraphDeployment(
  subgraphLineage: GraftableSubgraphStatus[],
): SubgraphDeploymentDecision[] {
  const deploymentDecisions: SubgraphDeploymentDecision[] = []

  // Check lineage size before making any assumptions.
  if (subgraphLineage.length < 2) {
    throw new Error(
      `Invalid input: Expected at least two members in graft lineage but got ${subgraphLineage.length}`,
    )
  }
  // Check for any unsynced base.
  // Iterate backwards while ignoring the target deployment (first element).
  for (let i = subgraphLineage.length - 1; i > 1; i--) {
    const graft = subgraphLineage[i]

    // Block height is stored in the previous element in the lineage list.
    // Since we are skipping the root (last element), the graft info is expected to be present.
    const desiredBlockHeight = subgraphLineage[i - 1].graft!.block

    if (!graft.indexingStatus || !graft.indexingStatus.latestBlock) {
      // Graph Node is not aware of this subgraph deployment. We must deploy it and look no further.
      deploymentDecisions.push({
        deployment: graft.deployment,
        deploymentDecision: SubgraphDeploymentDecisionKind.DEPLOY,
      })
      break
    } else {
      // Deployment exists.

      // Is it sufficiently synced?
      if (graft.indexingStatus.latestBlock.number >= desiredBlockHeight) {
        // If so, we can stop syncing it.
        deploymentDecisions.push({
          deployment: graft.deployment,
          deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
        })
        continue
      }

      // Is it healthy?
      if (graft.indexingStatus.health !== 'healthy') {
        throw new Error(`Unhealthy graft base: ${graft.deployment}`)
      }
    }
  }
  return deploymentDecisions
}
