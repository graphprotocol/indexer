import { base58 } from 'ethers/lib/utils'
import { BigNumber, utils } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@tokene-q/common-ts'
import { SubgraphDeployment } from './types'
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

// enum RuleType {
//   GLOBAL,
//   DEPLOYMENT,
//   SUBGRAPH,
// }

enum ActivationCriteria {
  NA = 'na',
  NONE = 'none',
  ALWAYS = 'always',
  SIGNAL_THRESHOLD = 'signal_threshold',
  MIN_STAKE = 'min_stake',
  MIN_AVG_QUERY_FEES = 'min_avg_query_fees',
  UNSUPPORTED = 'unsupported',
  NEVER = 'never',
  OFFCHAIN = 'offchain',
  INVALID_ALLOCATION_AMOUNT = 'invalid_allocation_amount',
}

interface RuleMatch {
  rule: IndexingRuleAttributes | undefined
  activationCriteria: ActivationCriteria
}

export class AllocationDecision {
  declare deployment: SubgraphDeploymentID
  declare toAllocate: boolean
  declare ruleMatch: RuleMatch

  constructor(
    deployment: SubgraphDeploymentID,
    matchingRule: IndexingRuleAttributes | undefined,
    toAllocate: boolean,
    ruleActivator: ActivationCriteria,
  ) {
    this.deployment = deployment
    this.toAllocate = toAllocate
    this.ruleMatch = {
      rule: matchingRule,
      activationCriteria: ruleActivator,
    }
  }
  public reasonString(): string {
    return `${this.ruleMatch.rule?.identifierType ?? 'none'}:${
      this.ruleMatch.activationCriteria
    }`
  }
}

export function evaluateDeployments(
  logger: Logger,
  networkDeployments: SubgraphDeployment[],
  rules: IndexingRuleAttributes[],
): AllocationDecision[] {
  return networkDeployments.map((deployment) =>
    isDeploymentWorthAllocatingTowards(logger, deployment, rules),
  )
}

export function isDeploymentWorthAllocatingTowards(
  logger: Logger,
  deployment: SubgraphDeployment,
  rules: IndexingRuleAttributes[],
): AllocationDecision {
  const globalRule = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)
  const deploymentRule =
    rules
      .filter((rule) => rule.identifierType == SubgraphIdentifierType.DEPLOYMENT)
      .find(
        (rule) =>
          new SubgraphDeploymentID(rule.identifier).bytes32 === deployment.id.bytes32,
      ) || globalRule

  logger.trace('Evaluating whether subgraphDeployment is worth allocating towards', {
    deployment,
    matchingRule: deploymentRule,
  })

  // The deployment is not eligible for deployment if it doesn't have an allocation amount
  if (!deploymentRule?.allocationAmount) {
    logger.debug(`Could not find matching rule with defined 'allocationAmount':`, {
      deployment: deployment.id.display,
    })
    return new AllocationDecision(
      deployment.id,
      deploymentRule,
      false,
      ActivationCriteria.INVALID_ALLOCATION_AMOUNT,
    )
  }

  // Reject unsupported subgraphs early
  if (deployment.deniedAt > 0 && deploymentRule.requireSupported) {
    return new AllocationDecision(
      deployment.id,
      deploymentRule,
      false,
      ActivationCriteria.UNSUPPORTED,
    )
  }

  switch (deploymentRule?.decisionBasis) {
    case undefined:
      return new AllocationDecision(
        deployment.id,
        undefined,
        false,
        ActivationCriteria.NA,
      )
    case IndexingDecisionBasis.ALWAYS:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        true,
        ActivationCriteria.ALWAYS,
      )
    case IndexingDecisionBasis.NEVER:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        false,
        ActivationCriteria.NEVER,
      )
    case IndexingDecisionBasis.OFFCHAIN:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        false,
        ActivationCriteria.OFFCHAIN,
      )
    case IndexingDecisionBasis.RULES: {
      const stakedTokens = BigNumber.from(deployment.stakedTokens)
      const signalledTokens = BigNumber.from(deployment.signalledTokens)
      const avgQueryFees = BigNumber.from(deployment.queryFeesAmount)

      if (deploymentRule.minStake && stakedTokens.gte(deploymentRule.minStake)) {
        return new AllocationDecision(
          deployment.id,
          deploymentRule,
          true,
          ActivationCriteria.MIN_STAKE,
        )
      } else if (
        deploymentRule.minSignal &&
        signalledTokens.gte(deploymentRule.minSignal)
      ) {
        return new AllocationDecision(
          deployment.id,
          deploymentRule,
          true,
          ActivationCriteria.SIGNAL_THRESHOLD,
        )
      } else if (
        deploymentRule.minAverageQueryFees &&
        avgQueryFees.gte(deploymentRule.minAverageQueryFees)
      ) {
        return new AllocationDecision(
          deployment.id,
          deploymentRule,
          true,
          ActivationCriteria.MIN_AVG_QUERY_FEES,
        )
      } else {
        return new AllocationDecision(
          deployment.id,
          deploymentRule,
          false,
          ActivationCriteria.NONE,
        )
      }
    }
  }
}
