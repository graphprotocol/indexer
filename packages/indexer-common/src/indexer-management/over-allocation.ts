import { formatGRT, Logger } from '@graphprotocol/common-ts'
import {
  GraphHorizonContracts,
  SubgraphServiceContracts,
} from '@graphprotocol/toolshed/deployments'
import { indexerError, IndexerErrorCode } from '../errors'

// Throws IE090 if the indexer is over-allocated on the SubgraphService.
// Used by reallocate paths: collect() would auto-close the existing allocation
// and the new allocation would be rejected, leaving the indexer with no
// allocation on the deployment. The indexer can still collect rewards by
// closing the allocation directly via `graph indexer allocations close`,
// which handles over-allocation gracefully.
export async function assertNotOverAllocated(
  contracts: GraphHorizonContracts & SubgraphServiceContracts,
  indexer: string,
  logger: Logger,
  allocationId: string,
): Promise<void> {
  const isOverAllocated = await contracts.SubgraphService.isOverAllocated(indexer)

  logger.debug('Checking over-allocation status for reallocate allocation', {
    allocationId,
    isOverAllocated,
  })

  if (!isOverAllocated) {
    return
  }

  const [allocatedTokens, delegationRatio] = await Promise.all([
    contracts.SubgraphService.allocationProvisionTracker(indexer),
    contracts.SubgraphService.getDelegationRatio(),
  ])
  const tokensAvailable = await contracts.HorizonStaking.getTokensAvailable(
    indexer,
    contracts.SubgraphService.target,
    delegationRatio,
  )
  const overallocatedAmount =
    allocatedTokens > tokensAvailable ? allocatedTokens - tokensAvailable : 0n
  throw indexerError(
    IndexerErrorCode.IE090,
    `Overallocated by ${formatGRT(
      overallocatedAmount,
    )} GRT. Close this allocation via 'graph indexer allocations close' to collect rewards, or add provision tokens before retrying reallocate.`,
  )
}
