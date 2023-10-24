import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { GraphNodeInterface } from './graph-node'
import { BlockPointer, SubgraphManifest } from './types'
import { indexerError, IndexerErrorCode } from './errors'

export interface GraftBase {
  block: number
  base: SubgraphDeploymentID
}

export interface GraftableSubgraph {
  deployment: SubgraphDeploymentID
  graft: GraftBase | null // Root subgraph does not have a graft base
}

type SubgraphManifestResolver = (
  subgraphID: SubgraphDeploymentID,
) => Promise<SubgraphManifest>

interface IndexingStatus {
  latestBlock: BlockPointer | null
  health: string
  synced: boolean
}

interface SubgraphGraftStatus extends GraftableSubgraph {
  indexingStatus: IndexingStatus | null
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
): Promise<SubgraphGraftStatus> {
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
