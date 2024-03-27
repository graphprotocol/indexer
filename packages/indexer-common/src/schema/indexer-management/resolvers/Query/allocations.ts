import { queryAllocations } from '../../../../indexer-management/resolvers/allocations'
import type { QueryResolvers } from './../../../types.generated'
import { toAddress } from '@graphprotocol/common-ts'
import { epochElapsedBlocks } from '../../../../indexer-management'

export const allocations: NonNullable<QueryResolvers['allocations']> = async (
  _parent,
  { filter },
  { logger, multiNetworks },
) => {
  logger.debug('Execute allocations() query', {
    filter,
  })
  if (!multiNetworks) {
    throw Error('IndexerManagementClient must be in `network` mode to fetch allocations')
  }

  const allocationsByNetwork = await multiNetworks.map(async (network) => {
    // Return early if a different protocol network is specifically requested
    if (
      filter.protocolNetwork &&
      filter.protocolNetwork !== network.specification.networkIdentifier
    ) {
      return []
    }

    const {
      networkMonitor,
      networkSubgraph,
      contracts,
      specification: {
        indexerOptions: { address },
      },
    } = network

    const [currentEpoch, maxAllocationEpochs, epochLength] = await Promise.all([
      networkMonitor.networkCurrentEpoch(),
      contracts.staking.maxAllocationEpochs(),
      contracts.epochManager.epochLength(),
    ])

    const allocation = filter.allocation
      ? filter.allocation === 'all'
        ? null
        : toAddress(filter.allocation)
      : null

    const variables = {
      indexer: toAddress(address),
      allocation,
      // TODO: we need to update schema to switch away from using `status` as a string
      status: filter.status as 'active' | 'closed',
    }

    const context = {
      currentEpoch: currentEpoch.epochNumber,
      currentEpochStartBlock: currentEpoch.startBlockNumber,
      currentEpochElapsedBlocks: epochElapsedBlocks(currentEpoch),
      latestBlock: currentEpoch.latestBlock,
      maxAllocationEpochs,
      blocksPerEpoch: epochLength.toNumber(),
      avgBlockTime: 13000,
      protocolNetwork: network.specification.networkIdentifier,
    }

    return queryAllocations(logger, networkSubgraph, variables, context)
  })

  return Object.values(allocationsByNetwork).flat()
}
