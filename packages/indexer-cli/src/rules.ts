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
import { BigNumber, utils } from 'ethers'
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
  if (!['always', 'never', 'rules', 'offchain'].includes(s)) {
    throw new Error(
      `Unknown decision basis "${s}". Supported: always, never, rules, offchain`,
    )
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
  identifier: x => x,
  identifierType: x => x,
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
  //deployment: (d: SubgraphDeploymentIDIsh) => (typeof d === 'string' ? d : d.ipfsHash),
  identifier: x => x,
  identifierType: x => x,
  allocationAmount: nullPassThrough(x => utils.commify(formatGRT(x))),
  parallelAllocations: nullPassThrough((x: number) => x.toString()),
  minSignal: nullPassThrough(x => utils.commify(formatGRT(x))),
  maxSignal: nullPassThrough(x => utils.commify(formatGRT(x))),
  minStake: nullPassThrough(x => utils.commify(formatGRT(x))),
  maxAllocationPercentage: nullPassThrough((x: number) => x.toPrecision(2)),
  minAverageQueryFees: nullPassThrough(x => utils.commify(formatGRT(x))),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
}

const INDEXING_RULE_CONVERTERS_FROM_GRAPHQL: Record<
  keyof IndexingRuleAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  identifier: x => x,
  identifierType: x => x,
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
  identifier: x => x,
  identifierType: x => x,
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
  identifier: string,
  ruleOrRules: Partial<IndexingRuleAttributes> | Partial<IndexingRuleAttributes>[] | null,
  keys: (keyof IndexingRuleAttributes)[],
): void => {
  if (Array.isArray(ruleOrRules)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules = ruleOrRules.map(rule => formatIndexingRule(pickFields(rule, keys)))

    const onchainRules = rules.filter(
      rule => rule?.decisionBasis !== IndexingDecisionBasis.OFFCHAIN,
    )
    const offchainRules = rules.filter(
      rule => rule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN,
    )

    print.info(displayIndexingRules(outputFormat, onchainRules))
    if (offchainRules) {
      print.info('Offchain syncing subgraphs')
      print.info(displayIndexingRules(outputFormat, offchainRules))
    } else {
      print.info(`Not syncing any subgraphs offchain`)
    }
  } else if (ruleOrRules) {
    const rule = formatIndexingRule(pickFields(ruleOrRules, keys))
    print.info(displayIndexingRule(outputFormat, rule))
  } else if (identifier) {
    print.error(`No rule found for subgraph identifier "${identifier}"`)
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
            identifier
            identifierType
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
  identifier: string,
  merged: boolean,
): Promise<Partial<IndexingRuleAttributes> | null> => {
  const result = await client
    .query(
      gql`
        query indexingRule($identifier: String!, $merged: Boolean!) {
          indexingRule(identifier: $identifier, merged: $merged) {
            identifier
            identifierType
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
      { identifier, merged },
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
            identifier
            identifierType
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
  identifiers: SubgraphDeploymentIDIsh[],
): Promise<void> => {
  const result = await client
    .mutation(
      gql`
        mutation deleteIndexingRules($deployments: [String!]!) {
          deleteIndexingRules(identifiers: $deployments)
        }
      `,
      { deployments: identifiers.map(identifier => identifier.toString()) },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }
}
