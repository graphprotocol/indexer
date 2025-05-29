import { SubgraphDeploymentID, formatGRT, commify } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { OutputFormat, parseOutputFormat, pickFields } from './command-helpers'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import {
  CloseAllocationResult,
  CreateAllocationResult,
  ReallocateAllocationResult,
  resolveChainAlias,
} from '@graphprotocol/indexer-common'

export interface IndexerAllocation {
  id: number
  indexer: string
  subgraphDeployment: string
  allocatedTokens: bigint
  signalledTokens: bigint
  stakedTokens: bigint
  createdAtEpoch: number
  closedAtEpoch: number | null
  ageInEpochs: number
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: bigint
  queryFeesCollected: bigint
  status: string
  protocolNetwork: string
  isLegacy: boolean
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
  allocatedTokens: nullPassThrough((x: string) => BigInt(x)),
  signalledTokens: nullPassThrough((x: string) => BigInt(x)),
  stakedTokens: nullPassThrough((x: string) => BigInt(x)),
  createdAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  closedAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  ageInEpochs: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineEpoch: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineBlocksRemaining: nullPassThrough((x: string) => parseInt(x)),
  closeDeadlineTimeRemaining: nullPassThrough((x: string) => parseInt(x)),
  indexingRewards: nullPassThrough((x: string) => BigInt(x)),
  queryFeesCollected: nullPassThrough((x: string) => BigInt(x)),
  status: x => x,
  protocolNetwork: x => x,
  isLegacy: x => x,
}

const ALLOCATION_FORMATTERS: Record<
  keyof IndexerAllocation,
  (x: never) => string | null
> = {
  id: nullPassThrough(x => x),
  indexer: nullPassThrough(x => x),
  subgraphDeployment: (d: SubgraphDeploymentID) =>
    typeof d === 'string' ? d : d.ipfsHash,
  allocatedTokens: x => commify(formatGRT(x)),
  signalledTokens: x => commify(formatGRT(x)),
  stakedTokens: x => commify(formatGRT(x)),
  createdAtEpoch: x => x,
  closedAtEpoch: x => x,
  ageInEpochs: x => x,
  closeDeadlineEpoch: x => x,
  closeDeadlineBlocksRemaining: x => x,
  closeDeadlineTimeRemaining: x => x,
  indexingRewards: x => commify(formatGRT(x)),
  queryFeesCollected: x => commify(formatGRT(x)),
  status: x => x,
  protocolNetwork: resolveChainAlias,
  isLegacy: x => (x ? 'Yes' : 'No'),
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
  outputFormat: OutputFormat,
  allocationOrAllocations:
    | Partial<IndexerAllocation>
    | Partial<IndexerAllocation>[]
    | null,
  keys: (keyof IndexerAllocation)[],
): void => {
  parseOutputFormat(print, outputFormat)
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
  outputFormat: OutputFormat,
  allocations: Partial<IndexerAllocation>[],
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(allocations, null, 2)
    : outputFormat === OutputFormat.Yaml
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
  outputFormat: OutputFormat,
  allocation: Partial<IndexerAllocation>,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(allocation, null, 2)
    : outputFormat === OutputFormat.Yaml
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
  amount: bigint,
  indexNode: string | undefined,
  protocolNetwork: string,
): Promise<CreateAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation createAllocation(
          $deployment: String!
          $amount: String!
          $protocolNetwork: String!
          $indexNode: String
        ) {
          createAllocation(
            deployment: $deployment
            amount: $amount
            protocolNetwork: $protocolNetwork
            indexNode: $indexNode
          ) {
            allocation
            deployment
            allocatedTokens
            protocolNetwork
          }
        }
      `,
      {
        deployment,
        amount: amount.toString(),
        indexNode,
        protocolNetwork,
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
  protocolNetwork: string,
): Promise<CloseAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation closeAllocation(
          $allocation: String!
          $poi: String
          $force: Boolean
          $protocolNetwork: String!
        ) {
          closeAllocation(
            allocation: $allocation
            poi: $poi
            force: $force
            protocolNetwork: $protocolNetwork
          ) {
            allocation
            allocatedTokens
            indexingRewards
            protocolNetwork
          }
        }
      `,
      {
        allocation: allocationID,
        poi,
        force,
        protocolNetwork,
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
  amount: bigint,
  force: boolean,
  protocolNetwork: string,
): Promise<ReallocateAllocationResult> => {
  const result = await client
    .mutation(
      gql`
        mutation reallocateAllocation(
          $allocation: String!
          $poi: String
          $amount: String!
          $force: Boolean
          $protocolNetwork: String!
        ) {
          reallocateAllocation(
            allocation: $allocation
            poi: $poi
            amount: $amount
            force: $force
            protocolNetwork: $protocolNetwork
          ) {
            closedAllocation
            indexingRewardsCollected
            createdAllocation
            createdAllocationStake
            protocolNetwork
          }
        }
      `,
      {
        allocation: allocationID,
        poi,
        amount: amount.toString(),
        force,
        protocolNetwork,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.reallocateAllocation
}

export const submitCollectReceiptsJob = async (
  client: IndexerManagementClient,
  allocationID: string,
  protocolNetwork: string,
): Promise<void> => {
  const result = await client
    .mutation(
      gql`
        mutation submitCollectReceiptsJob(
          $allocation: String!
          $protocolNetwork: String!
        ) {
          submitCollectReceiptsJob(
            allocation: $allocation
            protocolNetwork: $protocolNetwork
          )
        }
      `,
      {
        allocation: allocationID,
        protocolNetwork,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }
}
