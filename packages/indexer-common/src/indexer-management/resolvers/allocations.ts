/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import { IndexerManagementResolverContext } from '../client'
import pMap from 'p-map'
import gql from 'graphql-tag'
import { Client } from '@urql/core'
import {
  Address,
  NetworkContracts,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

interface AllocationFilter {
  active: boolean
  claimable: boolean
  allocations: string[] | null
}

enum QueryAllocationMode {
  Active,
  Claimable,
}

const ALLOCATION_QUERIES = {
  [QueryAllocationMode.Active]: {
    all: gql`
      query allocations($indexer: String!) {
        allocations(where: { indexer: $indexer, status: Active }, first: 1000) {
          id
          allocatedTokens
          createdAtEpoch
          closedAtEpoch
          subgraphDeployment {
            id
          }
        }
      }
    `,
    allocations: gql`
      query allocations($indexer: String!, $allocations: [String!]!) {
        allocations(
          where: { indexer: $indexer, status: Active, id_in: $allocations }
          first: 1000
        ) {
          id
          allocatedTokens
          createdAtEpoch
          closedAtEpoch
          subgraphDeployment {
            id
          }
        }
      }
    `,
  },

  [QueryAllocationMode.Claimable]: {
    all: gql`
      query allocations($indexer: String!, $disputableEpoch: Int!) {
        allocations(
          where: {
            indexer: $indexer
            closedAtEpoch_lte: $disputableEpoch
            status: Closed
          }
          first: 1000
        ) {
          id
          allocatedTokens
          createdAtEpoch
          closedAtEpoch
          subgraphDeployment {
            id
          }
        }
      }
    `,
    allocations: gql`
      query allocations(
        $indexer: String!
        $disputableEpoch: Int!
        $allocations: [String!]!
      ) {
        allocations(
          where: {
            indexer: $indexer
            closedAtEpoch_lte: $disputableEpoch
            status: Closed
            id_in: $allocations
          }
          first: 1000
        ) {
          id
          allocatedTokens
          createdAtEpoch
          closedAtEpoch
          subgraphDeployment {
            id
          }
        }
      }
    `,
  },
}

async function queryAllocations(
  networkSubgraph: Client,
  contracts: NetworkContracts,
  mode: QueryAllocationMode,
  variables: { indexer: Address; disputableEpoch: number; allocations: Address[] | null },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationEpochs: number
    blocksPerEpoch: number
    avgBlockTime: number
  },
): Promise<AllocationInfo[]> {
  const result = await networkSubgraph
    .query(
      variables.allocations === null
        ? ALLOCATION_QUERIES[mode]['all']
        : ALLOCATION_QUERIES[mode]['allocations'],
      variables.allocations == null
        ? {
            indexer: variables.indexer.toLowerCase(),
            disputableEpoch: variables.disputableEpoch,
          }
        : {
            indexer: variables.indexer.toLowerCase(),
            disputableEpoch: variables.disputableEpoch,
            allocations: variables.allocations.map((allocation) =>
              allocation.toLowerCase(),
            ),
          },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pMap(
    result.data.allocations,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (allocation: any): Promise<AllocationInfo> => {
      const deadlineEpoch = allocation.createdAtEpoch + context.maxAllocationEpochs
      const remainingBlocks =
        // blocks remaining in current epoch
        context.blocksPerEpoch -
        context.currentEpochElapsedBlocks +
        // blocks in the remaining epochs after this one
        context.blocksPerEpoch * (deadlineEpoch - context.currentEpoch - 1)

      return {
        id: allocation.id,
        deployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id).ipfsHash,
        allocatedTokens: BigNumber.from(allocation.allocatedTokens).toString(),
        createdAtEpoch: allocation.createdAtEpoch,
        closedAtEpoch: allocation.closedAtEpoch,
        closeDeadlineEpoch: allocation.createdAtEpoch + context.maxAllocationEpochs,
        closeDeadlineBlocksRemaining: remainingBlocks,
        closeDeadlineTimeRemaining: remainingBlocks * context.avgBlockTime,
        indexingRewards: (
          await contracts.rewardsManager.getRewards(allocation.id)
        ).toString(),
        queryFees: (
          await contracts.staking.getAllocation(allocation.id)
        ).collectedFees.toString(),
        status: mode === QueryAllocationMode.Active ? 'ACTIVE' : 'CLAIMABLE',
      }
    },
  )
}

export interface AllocationInfo {
  id: Address
  deployment: string
  allocatedTokens: string
  createdAtEpoch: number
  closedAtEpoch: number | null
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: string
  queryFees: string
  status: 'ACTIVE' | 'CLAIMABLE'
}

export default {
  allocations: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { filter }: { filter: AllocationFilter },
    { networkSubgraph, address, contracts }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const allocations: AllocationInfo[] = []

    const currentEpoch = await contracts.epochManager.currentEpoch()
    const disputeEpochs = await contracts.staking.channelDisputeEpochs()
    const variables = {
      indexer: toAddress(address),
      disputableEpoch: currentEpoch.sub(disputeEpochs).toNumber(),
      allocations: filter.allocations
        ? filter.allocations.map((allocation) => toAddress(allocation))
        : null,
    }
    const context = {
      currentEpoch: currentEpoch.toNumber(),
      currentEpochStartBlock: (
        await contracts.epochManager.currentEpochBlock()
      ).toNumber(),
      currentEpochElapsedBlocks: (
        await contracts.epochManager.currentEpochBlockSinceStart()
      ).toNumber(),
      latestBlock: (await contracts.epochManager.blockNum()).toNumber(),
      maxAllocationEpochs: await contracts.staking.maxAllocationEpochs(),
      blocksPerEpoch: (await contracts.epochManager.epochLength()).toNumber(),
      avgBlockTime: 13_000,
    }

    if (filter.active) {
      allocations.push(
        ...(await queryAllocations(
          networkSubgraph,
          contracts,
          QueryAllocationMode.Active,
          variables,
          context,
        )),
      )
    }

    if (filter.claimable) {
      allocations.push(
        ...(await queryAllocations(
          networkSubgraph,
          contracts,
          QueryAllocationMode.Claimable,
          variables,
          context,
        )),
      )
    }

    return allocations
  },
}
