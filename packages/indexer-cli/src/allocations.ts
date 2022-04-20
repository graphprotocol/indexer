import { SubgraphDeploymentID, formatGRT } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { BigNumber, utils } from 'ethers'
import { pickFields } from './command-helpers'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import {
  CloseAllocationResult,
  CreateAllocationResult,
  ReallocateAllocationResult,
} from '@graphprotocol/indexer-common'

export interface IndexerAllocation {
  id: number
  indexer: string
  subgraphDeployment: string
  allocatedTokens: BigNumber
  signalledTokens: BigNumber
  stakedTokens: BigNumber
  createdAtEpoch: number
  closedAtEpoch: number | null
  ageInEpochs: number
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: BigNumber
  queryFeesCollected: BigNumber
  status: string
}

const ALLOCATION_CONVERTERS_FROM_GRAPHQL: Record<
  keyof IndexerAllocation,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  indexer: x => x,
  subgraphDeployment: (d: SubgraphDeploymentID) =>
    typeof d === 'string' ? d : d.ipfsHash,
  allocatedTokens: nullPassThrough((x: string) => BigNumber.from(x)),
  signalledTokens: nullPassThrough((x: string) => BigNumber.from(x)),
  stakedTokens: nullPassThrough((x: string) => BigNumber.from(x)),
  createdAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  closedAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  ageInEpochs: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineEpoch: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineBlocksRemaining: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineTimeRemaining: nullPassThrough((x: string) => parseInt(x)),
  indexingRewards: nullPassThrough((x: string) => BigNumber.from(x)),
  queryFeesCollected: nullPassThrough((x: string) => BigNumber.from(x)),
  status: x => x,
}

const ALLOCATION_FORMATTERS: Record<
  keyof IndexerAllocation,
  (x: never) => string | null
> = {
  id: nullPassThrough(x => x),
  indexer: nullPassThrough(x => x),
  subgraphDeployment: (d: SubgraphDeploymentID) =>
    typeof d === 'string' ? d : d.ipfsHash,
  allocatedTokens: x => utils.commify(formatGRT(x)),
  signalledTokens: x => utils.commify(formatGRT(x)),
  stakedTokens: x => utils.commify(formatGRT(x)),
  createdAtEpoch: x => x,
  closedAtEpoch: x => x,
  ageInEpochs: x => x,
  closeDeadlineEpoch: x => x,
  closeDeadlineBlocksRemaining: x => x,
  closeDeadlineTimeRemaining: x => x,
  indexingRewards: x => utils.commify(formatGRT(x)),
  queryFeesCollected: x => utils.commify(formatGRT(x)),
  status: x => x,
}

/**
 * Formats an indexer allocation for display in the console.
 */
export const formatIndexerAllocation = (
  allocation: Partial<IndexerAllocation>,
): Partial<IndexerAllocation> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(allocation)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (ALLOCATION_FORMATTERS as any)[key](value)
  }

  return obj as Partial<IndexerAllocation>
}

/**
 * Parses an indexer allocation returned from the indexer management GraphQL
 * API into normalized form.
 */
export const indexerAllocationFromGraphQL = (
  allocation: Partial<IndexerAllocation>,
): Partial<IndexerAllocation> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(pickFields(allocation, []))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (ALLOCATION_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as Partial<IndexerAllocation>
}

export const printIndexerAllocations = (
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  allocationOrAllocations:
    | Partial<IndexerAllocation>
    | Partial<IndexerAllocation>[]
    | null,
  keys: (keyof IndexerAllocation)[],
): void => {
  if (Array.isArray(allocationOrAllocations)) {
    const allocations = allocationOrAllocations.map(allocation =>
      formatIndexerAllocation(pickFields(allocation, keys)),
    )
    print.info(displayIndexerAllocations(outputFormat, allocations))
  } else if (allocationOrAllocations) {
    const allocation = formatIndexerAllocation(pickFields(allocationOrAllocations, keys))
    print.info(displayIndexerAllocation(outputFormat, allocation))
  } else {
    print.error(`No allocations found`)
  }
}

export const displayIndexerAllocations = (
  outputFormat: 'table' | 'json' | 'yaml',
  allocations: Partial<IndexerAllocation>[],
): string =>
  outputFormat === 'json'
    ? JSON.stringify(allocations, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(allocations).trim()
    : allocations.length === 0
    ? 'No allocations found'
    : table(
        [
          Object.keys(allocations[0]),
          ...allocations.map(allocation => Object.values(allocation)),
        ],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()

export const displayIndexerAllocation = (
  outputFormat: 'table' | 'json' | 'yaml',
  allocation: Partial<IndexerAllocation>,
): string =>
  outputFormat === 'json'
    ? JSON.stringify(allocation, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(allocation).trim()
    : table([Object.keys(allocation), Object.values(allocation)], {
        border: getBorderCharacters('norc'),
      }).trim()

function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

export const createAllocation = async (
  client: IndexerManagementClient,
  deployment: string,
  amount: BigNumber,
  indexNode: string | undefined,
): Promise<CreateAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation createAllocation(
          $deployment: String!
          $amount: String!
          $indexNode: String
        ) {
          createAllocation(
            deployment: $deployment
            amount: $amount
            indexNode: $indexNode
          ) {
            allocation
            deployment
            allocatedTokens
          }
        }
      `,
      {
        deployment,
        amount: amount.toString(),
        indexNode,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.createAllocation
}

export const closeAllocation = async (
  client: IndexerManagementClient,
  allocationID: string,
  poi: string | undefined,
  force: boolean,
): Promise<CloseAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation closeAllocation($allocation: String!, $poi: String, $force: Boolean) {
          closeAllocation(allocation: $allocation, poi: $poi, force: $force) {
            allocation
            allocatedTokens
            indexingRewards
            receiptsWorthCollecting
          }
        }
      `,
      {
        allocation: allocationID,
        poi: poi,
        force: force,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.closeAllocation
}

export const reallocateAllocation = async (
  client: IndexerManagementClient,
  allocationID: string,
  poi: string | undefined,
  amount: BigNumber,
  force: boolean,
): Promise<ReallocateAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation reallocateAllocation(
          $allocation: String!
          $poi: String
          $amount: String!
          $force: Boolean
        ) {
          reallocateAllocation(
            allocation: $allocation
            poi: $poi
            amount: $amount
            force: $force
          ) {
            closedAllocation
            indexingRewardsCollected
            receiptsWorthCollecting
            createdAllocation
            createdAllocationStake
          }
        }
      `,
      {
        allocation: allocationID,
        poi: poi,
        amount: amount.toString(),
        force: force,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.reallocateAllocation
}
