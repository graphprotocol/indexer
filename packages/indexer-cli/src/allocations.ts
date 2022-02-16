import { SubgraphDeploymentID, formatGRT } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { BigNumber, utils } from 'ethers'
import { pickFields } from './command-helpers'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'

interface IndexerAllocation {
  id: number
  allocatedTokens: BigNumber
  createdAtEpoch: number
  closedAtEpoch: number | null
  subgraphDeployment: string
  signalledTokens: BigNumber
  stakedTokens: BigNumber
}

const ALLOCATION_CONVERTERS_FROM_GRAPHQL: Record<
  keyof IndexerAllocation,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  subgraphDeployment: (d: SubgraphDeploymentID) =>
    typeof d === 'string' ? d : d.ipfsHash,
  allocatedTokens: nullPassThrough((x: string) => BigNumber.from(x)),
  createdAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  closedAtEpoch: nullPassThrough((x: string) => parseInt(x)),
  signalledTokens: nullPassThrough((x: string) => BigNumber.from(x)),
  stakedTokens: nullPassThrough((x: string) => BigNumber.from(x)),
}

const ALLOCATION_FORMATTERS: Record<
  keyof IndexerAllocation,
  (x: never) => string | null
> = {
  id: nullPassThrough(x => x),
  subgraphDeployment: (d: SubgraphDeploymentID) =>
    typeof d === 'string' ? d : d.ipfsHash,
  allocatedTokens: x => utils.commify(formatGRT(x)),
  createdAtEpoch: x => x,
  closedAtEpoch: x => x,
  signalledTokens: x => utils.commify(formatGRT(x)),
  stakedTokens: x => utils.commify(formatGRT(x)),
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
    ? 'No data'
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
  deploymentID: string,
  amount: BigNumber,
): Promise<object> => {
  const result = await client
    .mutation(
      gql`
        mutation createAllocation(
          $deploymentID: String!
          $amount: String
          $rule: Boolean
        ) {
          createAllocation(deploymentID: $deploymentID, amount: $amount) {
            deploymentID
            amount
            success
            failureReason
          }
        }
      `,
      {
        deploymentID,
        amount: amount.toString(),
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.closeAllocation
}

export const closeAllocation = async (
  client: IndexerManagementClient,
  allocationID: string,
  poi: string | undefined,
  force: boolean,
): Promise<object> => {
  const result = await client
    .mutation(
      gql`
        mutation closeAllocation($id: String!, $poi: String, $force: Boolean) {
          closeAllocation(id: $id, poi: $poi, force: $force) {
            id
            success
            indexerRewards
          }
        }
      `,
      {
        id: allocationID,
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

export const refreshAllocation = async (
  client: IndexerManagementClient,
  allocationID: string,
  poi: string | undefined,
  amount: string,
  force: boolean,
): Promise<object> => {
  const result = await client
    .mutation(
      gql`
        mutation refreshAllocation(
          $id: String!
          $poi: String
          $amount: String!
          $force: Boolean
        ) {
          refreshAllocation(id: $id, poi: $poi, amount: $amount, force: $force) {
            id
            success
            indexerRewards
          }
        }
      `,
      {
        id: allocationID,
        poi: poi,
        amount,
        force: force,
      },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.closeAllocation
}
