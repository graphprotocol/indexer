import { base58 } from 'ethers/lib/utils'
import { BigNumber, utils } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { SubgraphDeployment } from './types'
import {
  INDEXING_RULE_GLOBAL,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
} from './indexer-management'
import { DocumentNode, print } from 'graphql'
import gql from 'graphql-tag'
import { QueryResult } from './subgraph-client'
import { mergeSelectionSets, sleep } from './utils'

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

export enum ActivationCriteria {
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
  L2_TRANSFER_SUPPORT = 'l2_transfer_support',
  DIPS = 'dips',
}

interface RuleMatch {
  rule: IndexingRuleAttributes | undefined
  activationCriteria: ActivationCriteria
}

export class AllocationDecision {
  declare deployment: SubgraphDeploymentID
  declare toAllocate: boolean
  declare ruleMatch: RuleMatch
  declare protocolNetwork: string

  constructor(
    deployment: SubgraphDeploymentID,
    matchingRule: IndexingRuleAttributes | undefined,
    toAllocate: boolean,
    ruleActivator: ActivationCriteria,
    protocolNetwork: string,
  ) {
    this.deployment = deployment
    this.toAllocate = toAllocate
    this.ruleMatch = {
      rule: matchingRule,
      activationCriteria: ruleActivator,
    }
    this.protocolNetwork = protocolNetwork
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
      deployment.protocolNetwork,
    )
  }

  // Reject unsupported subgraphs early
  if (deployment.deniedAt > 0 && deploymentRule.requireSupported) {
    return new AllocationDecision(
      deployment.id,
      deploymentRule,
      false,
      ActivationCriteria.UNSUPPORTED,
      deployment.protocolNetwork,
    )
  }

  switch (deploymentRule?.decisionBasis) {
    case undefined:
      return new AllocationDecision(
        deployment.id,
        undefined,
        false,
        ActivationCriteria.NA,
        deployment.protocolNetwork,
      )

    case IndexingDecisionBasis.DIPS:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        true,
        ActivationCriteria.DIPS,
        deployment.protocolNetwork,
      )
    case IndexingDecisionBasis.ALWAYS:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        true,
        ActivationCriteria.ALWAYS,
        deployment.protocolNetwork,
      )
    case IndexingDecisionBasis.NEVER:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        false,
        ActivationCriteria.NEVER,
        deployment.protocolNetwork,
      )
    case IndexingDecisionBasis.OFFCHAIN:
      return new AllocationDecision(
        deployment.id,
        deploymentRule,
        false,
        ActivationCriteria.OFFCHAIN,
        deployment.protocolNetwork,
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
          deployment.protocolNetwork,
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
          deployment.protocolNetwork,
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
          deployment.protocolNetwork,
        )
      } else {
        return new AllocationDecision(
          deployment.id,
          deploymentRule,
          false,
          ActivationCriteria.NONE,
          deployment.protocolNetwork,
        )
      }
    }
  }
}

export interface ProviderInterface {
  getBlockNumber(): Promise<number>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LoggerInterface {
  trace(msg: string, o?: object, ...args: any[]): void
  error(msg: string, o?: object, ...args: any[]): void
  warn(msg: string, o?: object, ...args: any[]): void
}

export interface SubgraphQueryInterface {
  query<Data = any>(
    query: DocumentNode,
    variables?: Record<string, any>,
  ): Promise<QueryResult<Data>>
  endpoint?: string
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const blockNumberQuery = gql`
  {
    _meta {
      block {
        number
      }
    }
  }
`

interface BlockNumberInterface {
  data: { _meta: { block: { number: number } } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors?: any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Variables = Record<string, any>

export class SubgraphFreshnessChecker {
  subgraphName: string
  provider: ProviderInterface
  threshold: number
  logger: LoggerInterface
  sleepDurationMillis: number
  retries: number

  constructor(
    subgraphName: string,
    provider: ProviderInterface,
    freshnessThreshold: number,
    sleepDurationMillis: number,
    logger: LoggerInterface,
    retries: number,
  ) {
    this.subgraphName = subgraphName
    this.provider = provider
    this.threshold = freshnessThreshold
    this.sleepDurationMillis = sleepDurationMillis
    this.logger = logger
    this.retries = retries
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async checkedQuery<Data = any>(
    subgraph: SubgraphQueryInterface,
    query: DocumentNode,
    variables?: Variables,
  ): Promise<QueryResult<Data>> {
    // Try to inject the latest block number into the original query.
    let updatedQuery = query
    try {
      updatedQuery = mergeSelectionSets(query, blockNumberQuery)
    } catch (err) {
      const errorMsg = `Failed to append block number into ${this.subgraphName} query`
      this.logger.error(errorMsg, { subgraph: this.subgraphName, query: print(query) })
      throw new Error(errorMsg)
    }

    // Try obtaining a fresh subgraph query at most `this.retry` times
    return this.checkedQueryRecursive<Data>(
      updatedQuery,
      subgraph,
      this.retries,
      variables,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async checkedQueryRecursive<Data = any>(
    updatedQuery: DocumentNode,
    subgraph: SubgraphQueryInterface,
    retriesLeft: number,
    variables?: Variables,
  ): Promise<QueryResult<Data>> {
    if (retriesLeft < 0) {
      const errorMsg = `Max retries reached for ${this.subgraphName} freshness check`
      this.logger.error(errorMsg, {
        subgraph: this.subgraphName,
        query: print(updatedQuery),
        endpoint: subgraph.endpoint,
      })
      throw new Error(errorMsg)
    }

    // Obtain the latest network block number and subgraph query in parallel.
    const subgraphQueryPromise = subgraph.query(updatedQuery, variables) as Promise<
      QueryResult<Data> & BlockNumberInterface
    >
    const latestNetworkBlockPromise = this.provider.getBlockNumber()
    const [subgraphQueryResult, latestNetworkBlock] = await Promise.all([
      subgraphQueryPromise,
      latestNetworkBlockPromise,
    ])

    // Return it early if query results contains errors
    if (subgraphQueryResult.errors || subgraphQueryResult.error) {
      return subgraphQueryResult
    }

    // Check for missing block metadata
    const queryShapeError = this.checkMalformedQueryResult(subgraphQueryResult)
    if (queryShapeError) {
      const errorMsg = `Failed to infer block number for ${this.subgraphName} query: ${queryShapeError}`
      this.logger.error(errorMsg, {
        query: print(updatedQuery),
        subgraph: this.subgraphName,
        error: queryShapeError,
        subgraphQueryResult,
        endpoint: subgraph.endpoint,
      })
      throw new Error(errorMsg)
    }

    // At this point we have validated that this value exists and is numeric.
    const latestIndexedBlock: number = subgraphQueryResult.data._meta.block.number

    // Check subgraph freshness
    const blockDistance = latestNetworkBlock - latestIndexedBlock
    const logInfo = {
      latestIndexedBlock,
      latestNetworkBlock,
      blockDistance,
      freshnessThreshold: this.threshold,
      subgraph: this.subgraphName,
      retriesLeft,
      endpoint: subgraph.endpoint,
    }
    this.logger.trace('Performing subgraph freshness check', logInfo)

    if (blockDistance < 0) {
      // Invariant violated: Subgraph can't be ahead of network latest block
      const errorMsg = `${this.subgraphName}'s latest indexed block (${latestIndexedBlock}) is higher than Network's latest block (${latestNetworkBlock})`
      this.logger.trace(errorMsg, logInfo)
    }

    if (blockDistance > this.threshold) {
      // Reenter function
      this.logger.warn(
        `${this.subgraphName} is not fresh. Sleeping for ${this.sleepDurationMillis} ms before retrying`,
        logInfo,
      )
      await sleep(this.sleepDurationMillis)
      return this.checkedQueryRecursive(
        updatedQuery,
        subgraph,
        retriesLeft - 1,
        variables,
      )
    } else {
      this.logger.trace(`${this.subgraphName} is fresh`, logInfo)
    }
    return subgraphQueryResult
  }

  // Checks if the query result has the expecte
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkMalformedQueryResult(subgraphQueryResult: any): string | undefined {
    if (!subgraphQueryResult) {
      return 'Subgraph query result is null or undefined'
    }
    if (!subgraphQueryResult.data) {
      return 'Subgraph query data is null or undefined'
    }
    if (!subgraphQueryResult.data._meta) {
      return 'Query metadata is null or undefined'
    }
    if (!subgraphQueryResult.data._meta.block) {
      return 'Block metadata is null or undefined'
    }
    if (
      !subgraphQueryResult.data._meta.block.number &&
      typeof subgraphQueryResult.data._meta.block.number === 'number'
    ) {
      return 'Block number is null or undefined'
    }
  }
}
