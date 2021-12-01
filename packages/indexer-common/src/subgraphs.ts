import { base58 } from 'ethers/lib/utils'
import { utils } from 'ethers'

export enum SubgraphIdentifierType {
  DEPLOYMENT = 'deployment',
  SUBGRAPH = 'subgraph',
  GROUP = 'group',
}

export async function validateSubgraphID(
  s: string | undefined,
): Promise<SubgraphIdentifierType> {
  const type = SubgraphIdentifierType.SUBGRAPH
  // Case 1: undefined
  if (s === undefined) {
    throw new Error(`No subgraph ID provided. Must be a valid subgraph ID`)
  }

  if (typeof s !== 'string') {
    throw new Error('Subgraph ID must be a string')
  }

  const values = s.split('-')
  if (
    values.length == 2 &&
    utils.isHexString(values[0], 20) &&
    !isNaN(parseInt(values[1]))
  ) {
    return type
  }

  throw new Error(
    `Subgraph ID is not formatted correctly. Must take the form '0x00000000000000000000-01'`,
  )
}

export async function validateDeploymentID(
  s: string | undefined,
): Promise<SubgraphIdentifierType> {
  const type = SubgraphIdentifierType.DEPLOYMENT
  // Case 1: undefined
  if (s === undefined) {
    throw new Error(`No deployment ID provided. Must be a valid deployment ID`)
  }

  // Case 4: 'Qm...'
  try {
    // This will throw if it's not valid
    base58.decode(s)

    if (s.length === 46) {
      return type
    }
  } catch {
    // no-op
  }

  // Case 5: '0x...' (32 bytes)
  try {
    if (utils.isHexString(s, 32)) {
      return type
    }
  } catch {
    // no-op
  }

  throw new Error(`Invalid deployment ID "${s}"`)
}

export async function validateSubgraphGroupID(
  s: string | undefined,
  { all, global }: { all?: boolean; global?: boolean },
): Promise<SubgraphIdentifierType> {
  const type = SubgraphIdentifierType.GROUP
  // Case 1: undefined
  if (s === undefined) {
    throw new Error(
      `No ID provided. Must be a valid subgraph group ID (${
        global ? ' or "global"' : ''
      }${all ? ' or "all"' : ''})`,
    )
  }

  // Case 2: 'global'
  if (global && s === 'global') {
    return type
  }

  // Case 3 (only if permitted): 'all'
  if (all && s === 'all') {
    return type
  }

  throw new Error(`Invalid subgraph group ID "${s}"`)
}

export async function processIdentifier(
  identifier: string,
  { all, global }: { all?: boolean; global?: boolean },
): Promise<[string, SubgraphIdentifierType]> {
  let type = SubgraphIdentifierType.GROUP
  const validationActions = [
    validateDeploymentID(identifier),
    validateSubgraphID(identifier),
    validateSubgraphGroupID(identifier, { all, global }),
  ]
  const results = await Promise.allSettled(validationActions)
  const rejected = results.filter(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult[]
  const fulfilled = results.filter(
    (result) => result.status === 'fulfilled',
  ) as PromiseFulfilledResult<SubgraphIdentifierType>[]
  if (rejected.length > 2 || fulfilled.length !== 1) {
    throw new Error(
      `Invalid subgraph identifier "${identifier}". Subgraph identifier should match 1 type of [deployment ID, subgraph ID, group identifier].`,
    )
  }
  type = fulfilled[0].value
  return [identifier, type]
}
