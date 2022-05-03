import { base58 } from 'ethers/lib/utils'
import { BigNumber, utils } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { SubgraphDeployment } from './allocations'
import {
  INDEXING_RULE_GLOBAL,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
} from './indexer-management'

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

  throw new Error(
    `Invalid deployment ID "${s}". Cost models currently must use deployment identifiers, please provide a valid deployment ID.`,
  )
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

  return [
    type == SubgraphIdentifierType.DEPLOYMENT
      ? new SubgraphDeploymentID(identifier).ipfsHash
      : identifier,
    type,
  ]
}

export function isDeploymentWorthAllocatingTowards(
  logger: Logger,
  deployment: SubgraphDeployment,
  rules: IndexingRuleAttributes[],
): boolean {
  const globalRule = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)
  const deploymentRule =
    rules
      .filter((rule) => rule.identifierType == SubgraphIdentifierType.DEPLOYMENT)
      .find(
        (rule) =>
          new SubgraphDeploymentID(rule.identifier).bytes32 === deployment.id.bytes32,
      ) || globalRule
  // The deployment is not eligible for deployment if it doesn't have an allocation amount
  if (!deploymentRule?.allocationAmount) {
    logger.debug(`Could not find matching rule with non-zero 'allocationAmount':`, {
      deployment: deployment.id.display,
    })
    return false
  }

  if (deploymentRule) {
    const stakedTokens = BigNumber.from(deployment.stakedTokens)
    const signalledTokens = BigNumber.from(deployment.signalledTokens)
    const avgQueryFees = BigNumber.from(deployment.queryFeesAmount).div(
      BigNumber.from(Math.max(1, deployment.activeAllocations)),
    )

    logger.trace('Deciding whether to allocate and index', {
      deployment: {
        id: deployment.id.display,
        deniedAt: deployment.deniedAt,
        stakedTokens: stakedTokens.toString(),
        signalledTokens: signalledTokens.toString(),
        avgQueryFees: avgQueryFees.toString(),
      },
      indexingRule: {
        decisionBasis: deploymentRule.decisionBasis,
        deployment: deploymentRule.identifier,
        minStake: deploymentRule.minStake
          ? BigNumber.from(deploymentRule.minStake).toString()
          : null,
        minSignal: deploymentRule.minSignal
          ? BigNumber.from(deploymentRule.minSignal).toString()
          : null,
        maxSignal: deploymentRule.maxSignal
          ? BigNumber.from(deploymentRule.maxSignal).toString()
          : null,
        minAverageQueryFees: deploymentRule.minAverageQueryFees
          ? BigNumber.from(deploymentRule.minAverageQueryFees).toString()
          : null,
        requireSupported: deploymentRule.requireSupported,
      },
    })

    // Reject unsupported subgraph by default
    if (deployment.deniedAt > 0 && deploymentRule.requireSupported) {
      return false
    }

    // Skip the indexing rules checks if the decision basis is 'always', 'never', or 'offchain'
    if (deploymentRule?.decisionBasis === IndexingDecisionBasis.ALWAYS) {
      return true
    } else if (
      deploymentRule?.decisionBasis === IndexingDecisionBasis.NEVER ||
      deploymentRule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN
    ) {
      return false
    }

    return (
      // stake >= minStake?
      ((deploymentRule.minStake &&
        stakedTokens.gte(deploymentRule.minStake)) as boolean) ||
      // signal >= minSignal && signal <= maxSignal?
      ((deploymentRule.minSignal &&
        signalledTokens.gte(deploymentRule.minSignal)) as boolean) ||
      ((deploymentRule.maxSignal &&
        signalledTokens.lte(deploymentRule.maxSignal)) as boolean) ||
      // avgQueryFees >= minAvgQueryFees?
      ((deploymentRule.minAverageQueryFees &&
        avgQueryFees.gte(deploymentRule.minAverageQueryFees)) as boolean)
    )
  } else {
    return false
  }
}
