import { SubgraphDeploymentID, parseGRT, formatGRT } from '@graphprotocol/common-ts'
import {
  IndexerManagementClient,
  IndexingRuleAttributes,
  IndexingDecisionBasis,
} from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { BigNumber } from 'ethers'
import { pickFields } from './command-helpers'

export type SubgraphDeploymentIDIsh = SubgraphDeploymentID | 'global' | 'all'

export const parseDeploymentID = (s: string): SubgraphDeploymentIDIsh => {
  if (s === 'all' || s === 'global') {
    return s
  } else {
    return new SubgraphDeploymentID(s)
  }
}

export const parseDecisionBasis = (s: string): IndexingDecisionBasis => {
  if (!['always', 'never', 'rules'].includes(s)) {
    throw new Error(`Unknown decision basis "${s}". Supported: always, never, rules`)
  } else {
    return s as IndexingDecisionBasis
  }
}

function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const INDEXING_RULE_PARSERS: Record<keyof IndexingRuleAttributes, (x: never) => any> = {
  id: x => x,
  deployment: parseDeploymentID,
  allocationAmount: nullPassThrough(parseGRT),
  parallelAllocations: nullPassThrough(parseInt),
  minSignal: nullPassThrough(parseGRT),
  maxSignal: nullPassThrough(parseGRT),
  minStake: nullPassThrough(parseGRT),
  maxAllocationPercentage: nullPassThrough(parseFloat),
  minAverageQueryFees: nullPassThrough(parseGRT),
  decisionBasis: nullPassThrough(parseDecisionBasis),
  custom: nullPassThrough(JSON.parse),
}

const INDEXING_RULE_FORMATTERS: Record<
  keyof IndexingRuleAttributes,
  (x: never) => string | null
> = {
  id: nullPassThrough(x => x),
  deployment: (d: SubgraphDeploymentIDIsh) => (typeof d === 'string' ? d : d.ipfsHash),
  allocationAmount: nullPassThrough(formatGRT),
  parallelAllocations: nullPassThrough((x: number) => x.toString()),
  minSignal: nullPassThrough(formatGRT),
  maxSignal: nullPassThrough(formatGRT),
  minStake: nullPassThrough(formatGRT),
  maxAllocationPercentage: nullPassThrough((x: number) => x.toPrecision(2)),
  minAverageQueryFees: nullPassThrough(formatGRT),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
}

const INDEXING_RULE_CONVERTERS_FROM_GRAPHQL: Record<
  keyof IndexingRuleAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  deployment: parseDeploymentID,
  allocationAmount: nullPassThrough((x: string) => BigNumber.from(x)),
  parallelAllocations: nullPassThrough((x: string) => parseInt(x)),
  minSignal: nullPassThrough((x: string) => BigNumber.from(x)),
  maxSignal: nullPassThrough((x: string) => BigNumber.from(x)),
  minStake: nullPassThrough((x: string) => BigNumber.from(x)),
  maxAllocationPercentage: nullPassThrough((x: string) => parseFloat(x)),
  minAverageQueryFees: nullPassThrough((x: string) => BigNumber.from(x)),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
}

const INDEXING_RULE_CONVERTERS_TO_GRAPHQL: Record<
  keyof IndexingRuleAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  deployment: (x: SubgraphDeploymentIDIsh) => x.toString(),
  allocationAmount: nullPassThrough((x: BigNumber) => x.toString()),
  parallelAllocations: nullPassThrough((x: number) => x),
  minSignal: nullPassThrough((x: BigNumber) => x.toString()),
  maxSignal: nullPassThrough((x: BigNumber) => x.toString()),
  minStake: nullPassThrough((x: BigNumber) => x.toString()),
  maxAllocationPercentage: nullPassThrough((x: number) => x),
  minAverageQueryFees: nullPassThrough((x: BigNumber) => x.toString()),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
}

/**
 * Parses a user-provided indexing rule into a normalized form.
 */
export const parseIndexingRule = (
  rule: Partial<IndexingRuleAttributes>,
): Partial<IndexingRuleAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(rule)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (INDEXING_RULE_PARSERS as any)[key](value)
  }
  return obj as Partial<IndexingRuleAttributes>
}

/**
 * Formats an indexing rule for display in the console.
 */
export const formatIndexingRule = (
  rule: Partial<IndexingRuleAttributes>,
): Partial<IndexingRuleAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(rule)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (INDEXING_RULE_FORMATTERS as any)[key](value)
  }
  return obj as Partial<IndexingRuleAttributes>
}

/**
 * Parses an indexing rule returned from the indexer management GraphQL
 * API into normalized form.
 */
export const indexingRuleFromGraphQL = (
  rule: Partial<IndexingRuleAttributes>,
): Partial<IndexingRuleAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(pickFields(rule, []))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (INDEXING_RULE_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as Partial<IndexingRuleAttributes>
}

/**
 * Converts a normalized indexing rule to a representation
 * compatible with the indexer management GraphQL API.
 */
export const indexingRuleToGraphQL = (
  rule: Partial<IndexingRuleAttributes>,
): Partial<IndexingRuleAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(rule)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (INDEXING_RULE_CONVERTERS_TO_GRAPHQL as any)[key](value)
  }
  return obj as Partial<IndexingRuleAttributes>
}

export const displayIndexingRules = (
  outputFormat: 'table' | 'json' | 'yaml',
  rules: Partial<IndexingRuleAttributes>[],
): string =>
  outputFormat === 'json'
    ? JSON.stringify(rules, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(rules).trim()
    : rules.length === 0
    ? 'No data'
    : table([Object.keys(rules[0]), ...rules.map(rule => Object.values(rule))], {
        border: getBorderCharacters('norc'),
      }).trim()

export const displayIndexingRule = (
  outputFormat: 'table' | 'json' | 'yaml',
  rule: Partial<IndexingRuleAttributes>,
): string =>
  outputFormat === 'json'
    ? JSON.stringify(rule, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(rule).trim()
    : table([Object.keys(rule), Object.values(rule)], {
        border: getBorderCharacters('norc'),
      }).trim()

export const printIndexingRules = (
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  deployment: SubgraphDeploymentIDIsh | null,
  ruleOrRules: Partial<IndexingRuleAttributes> | Partial<IndexingRuleAttributes>[] | null,
  keys: (keyof IndexingRuleAttributes)[],
): void => {
  if (Array.isArray(ruleOrRules)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules = ruleOrRules.map(rule => formatIndexingRule(pickFields(rule, keys)))
    print.info(displayIndexingRules(outputFormat, rules))
  } else if (ruleOrRules) {
    const rule = formatIndexingRule(pickFields(ruleOrRules, keys))
    print.info(displayIndexingRule(outputFormat, rule))
  } else if (deployment) {
    print.error(`No rule found for "${deployment}"`)
  } else {
    print.error(`No indexing rules found`)
  }
}

export const indexingRules = async (
  client: IndexerManagementClient,
  merged: boolean,
): Promise<Partial<IndexingRuleAttributes>[]> => {
  const result = await client
    .query(
      gql`
        query indexingRules($merged: Boolean!) {
          indexingRules(merged: $merged) {
            deployment
            allocationAmount
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
          }
        }
      `,
      { merged: !!merged },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.indexingRules.map(indexingRuleFromGraphQL)
}

export const indexingRule = async (
  client: IndexerManagementClient,
  deployment: SubgraphDeploymentID | 'global',
  merged: boolean,
): Promise<Partial<IndexingRuleAttributes> | null> => {
  const result = await client
    .query(
      gql`
        query indexingRule($deployment: String!, $merged: Boolean!) {
          indexingRule(deployment: $deployment, merged: $merged) {
            deployment
            allocationAmount
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
          }
        }
      `,
      { deployment: deployment.toString(), merged },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  if (result.data.indexingRule) {
    return indexingRuleFromGraphQL(result.data.indexingRule)
  } else {
    return null
  }
}

export const setIndexingRule = async (
  client: IndexerManagementClient,
  rule: Partial<IndexingRuleAttributes>,
): Promise<Partial<IndexingRuleAttributes>> => {
  const result = await client
    .mutation(
      gql`
        mutation setIndexingRule($rule: IndexingRuleInput!) {
          setIndexingRule(rule: $rule) {
            deployment
            allocationAmount
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
          }
        }
      `,
      { rule: indexingRuleToGraphQL(rule) },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return indexingRuleFromGraphQL(result.data.setIndexingRule)
}

export const deleteIndexingRules = async (
  client: IndexerManagementClient,
  deployments: SubgraphDeploymentIDIsh[],
): Promise<void> => {
  const result = await client
    .mutation(
      gql`
        mutation deleteIndexingRules($deployments: [String!]!) {
          deleteIndexingRules(deployments: $deployments)
        }
      `,
      { deployments: deployments.map(deployment => deployment.toString()) },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }
}
