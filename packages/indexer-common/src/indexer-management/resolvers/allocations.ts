/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { Client } from '@urql/core'
import { BigNumber, utils } from 'ethers'
import {
  Address,
  NetworkContracts,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import { IndexerManagementResolverContext } from '../client'
import { executeTransaction } from '../../transactions'
import { execute } from 'graphql'

interface AllocationFilter {
  active: boolean
  claimable: boolean
  allocations: string[] | null
}

enum QueryAllocationMode {
  Active,
  Claimable,
}

export interface AllocationInfo {
  id: Address
  deployment: string
  allocatedTokens: string
  createdAtEpoch: number
  closedAtEpoch: number | null
  ageInEpochs: number
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: string
  queryFees: string
  status: 'ACTIVE' | 'CLAIMABLE'
}

export interface CloseAllocationRequest {
  id: string
}

export interface CloseAllocationResult {
  id: string
  success: boolean
  indexerRewards: string
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
        ageInEpochs: allocation.closedAtEpoch
          ? allocation.closedAtEpoch - allocation.createdAtEpoch
          : context.currentEpoch - allocation.createdAtEpoch,
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

  closeAllocations: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { requests }: { requests: CloseAllocationRequest[] },
    {
      networkSubgraph,
      address,
      contracts,
      ethereum,
      logger,
      paused,
      isOperator,
    }: IndexerManagementResolverContext,
  ): Promise<CloseAllocationResult[]> => {
    const results: CloseAllocationResult[] = []
    const errors: Error[] = []

    for (const request of requests) {
      try {
        // Obtain the start block of the current epoch
        const epochStartBlockNumber = await contracts.epochManager.currentEpochBlock()
        const epochStartBlock = await ethereum.getBlock(epochStartBlockNumber.toNumber())

        // Obtain the deployment ID of the allocation
        const deployment = await queryAllocationDeployment(
          networkSubgraph,
          toAddress(request.id),
        )

        const poi = await this.indexer.proofOfIndexing(
          deployment.ipfsHash,
          epochStartBlock.hash,
        )

        // Don't proceed if the POI is 0x0 or null
        if (poi === null || poi === utils.hexlify(Array(32).fill(0))) {
          throw new Error(`Allocation "${request.id}" is missing a proof Of indexing`)
        }

        await executeTransaction(
          logger,
          paused,
          isOperator,
          () => contracts.staking.estimateGas.closeAllocation(request.id, poi),
          (gasLimit) =>
            contracts.staking.closeAllocation(request.id, poi, {
              gasLimit,
            }),
        )
      } catch (err) {
        errors.push(err)
      }
    }

    return results
  },
}
