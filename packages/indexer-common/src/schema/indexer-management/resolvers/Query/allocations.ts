import type { Allocation, QueryResolvers } from './../../../types.generated'
import {
  Address,
  Logger,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import { epochElapsedBlocks } from '../../../../indexer-management'
import { NetworkSubgraph } from '@graphprotocol/indexer-common'
import { BigNumber } from 'ethers'
import gql from 'graphql-tag'
import pMap from 'p-map'

enum AllocationQuery {
  all = 'all',
  active = 'active',
  closed = 'closed',
  allocation = 'allocation',
}

const ALLOCATION_QUERIES = {
  [AllocationQuery.all]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer }, first: 1000) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
      }
    }
  `,
  [AllocationQuery.active]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer, status: Active }, first: 1000) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
      }
    }
  `,
  [AllocationQuery.closed]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer, status: Closed }, first: 1000) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
      }
    }
  `,
  [AllocationQuery.allocation]: gql`
    query allocations($allocation: String!) {
      allocations(where: { id: $allocation }, first: 1000) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
      }
    }
  `,
}

async function queryAllocations(
  logger: Logger,
  networkSubgraph: NetworkSubgraph,
  variables: {
    indexer: Address
    allocation: Address | null
    status: 'active' | 'closed' | null
  },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationEpochs: number
    blocksPerEpoch: number
    avgBlockTime: number
    protocolNetwork: string
  },
): Promise<Allocation[]> {
  logger.trace('Query Allocations', {
    variables,
    context,
  })

  let filterType: AllocationQuery
  let filterVars: object
  if (variables.allocation) {
    filterType = AllocationQuery.allocation
    filterVars = {
      allocation: variables.allocation.toLowerCase(),
    }
  } else if (variables.status == null && variables.allocation == null) {
    filterType = AllocationQuery.all
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else if (variables.status == 'active') {
    filterType = AllocationQuery.active
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else if (variables.status == 'closed') {
    filterType = AllocationQuery.closed
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else {
    // Shouldn't ever get here
    throw new Error(
      `Unsupported combination of variables provided, variables: ${variables}`,
    )
  }

  const result = await networkSubgraph.checkedQuery(
    ALLOCATION_QUERIES[filterType],
    filterVars,
  )

  if (result.data.allocations.length == 0) {
    // TODO: Is 'Claimable' still the correct term here, after Exponential Rebates?
    logger.info(`No 'Claimable' allocations found`)
    return []
  }

  if (result.error) {
    logger.warning('Query failed', {
      error: result.error,
    })
    throw result.error
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pMap(
    result.data.allocations,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (allocation: any): Promise<Allocation> => {
      const deadlineEpoch = allocation.createdAtEpoch + context.maxAllocationEpochs
      const remainingBlocks =
        // blocks remaining in current epoch
        context.blocksPerEpoch -
        context.currentEpochElapsedBlocks +
        // blocks in the remaining epochs after this one
        context.blocksPerEpoch * (deadlineEpoch - context.currentEpoch - 1)
      return {
        id: allocation.id,
        indexer: allocation.indexer.id,
        subgraphDeployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id)
          .ipfsHash,
        signalledTokens: allocation.subgraphDeployment.signalledTokens,
        stakedTokens: allocation.subgraphDeployment.stakedTokens,
        allocatedTokens: BigNumber.from(allocation.allocatedTokens).toString(),
        createdAtEpoch: allocation.createdAtEpoch,
        closedAtEpoch: allocation.closedAtEpoch,
        ageInEpochs: allocation.closedAtEpoch
          ? allocation.closedAtEpoch - allocation.createdAtEpoch
          : context.currentEpoch - allocation.createdAtEpoch,
        closeDeadlineEpoch: allocation.createdAtEpoch + context.maxAllocationEpochs,
        closeDeadlineBlocksRemaining: remainingBlocks,
        closeDeadlineTimeRemaining: remainingBlocks * context.avgBlockTime,
        indexingRewards: allocation.indexingRewards,
        queryFeesCollected: allocation.queryFeesCollected,
        status: allocation.status,
        protocolNetwork: context.protocolNetwork,
      }
    },
  )
}

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
