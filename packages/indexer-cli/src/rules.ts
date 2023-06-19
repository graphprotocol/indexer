import { SubgraphDeploymentID, parseGRT, formatGRT } from '@tokene-q/common-ts'
import {
  nullPassThrough,
  parseBoolean,
  parseDecisionBasis,
  IndexerManagementClient,
  IndexingRuleAttributes,
  IndexingDecisionBasis,
} from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import yaml from 'yaml'
import { table, getBorderCharacters } from 'table'
import { BigNumber, utils } from 'ethers'
import { OutputFormat, pickFields } from './command-helpers'
import chalk from 'chalk'

export type SubgraphDeploymentIDIsh = SubgraphDeploymentID | 'global' | 'all'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const INDEXING_RULE_PARSERS: Record<keyof IndexingRuleAttributes, (x: never) => any> = {
  id: x => x,
  identifier: x => x,
  identifierType: x => x,
  allocationAmount: nullPassThrough(parseGRT),
  allocationLifetime: nullPassThrough(parseInt),
  autoRenewal: nullPassThrough(parseBoolean),
  parallelAllocations: nullPassThrough(parseInt),
  minSignal: nullPassThrough(parseGRT),
  maxSignal: nullPassThrough(parseGRT),
  minStake: nullPassThrough(parseGRT),
  maxAllocationPercentage: nullPassThrough(parseFloat),
  minAverageQueryFees: nullPassThrough(parseGRT),
  decisionBasis: nullPassThrough(parseDecisionBasis),
  custom: nullPassThrough(JSON.parse),
  requireSupported: x => parseBoolean(x),
  safety: x => parseBoolean(x),
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
  allocationLifetime: nullPassThrough((x: number) => x.toString()),
  autoRenewal: x => x,
  parallelAllocations: nullPassThrough((x: number) => x.toString()),
  maxSignal: nullPassThrough(x => utils.commify(formatGRT(x))),
  minSignal: nullPassThrough(x => utils.commify(formatGRT(x))),
  minStake: nullPassThrough(x => utils.commify(formatGRT(x))),
  maxAllocationPercentage: nullPassThrough((x: number) => x.toPrecision(2)),
  minAverageQueryFees: nullPassThrough(x => utils.commify(formatGRT(x))),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
  requireSupported: x => x,
  safety: x => x,
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
  allocationLifetime: nullPassThrough((x: string) => parseInt(x)),
  autoRenewal: x => x,
  parallelAllocations: nullPassThrough((x: string) => parseInt(x)),
  minSignal: nullPassThrough((x: string) => BigNumber.from(x)),
  maxSignal: nullPassThrough((x: string) => BigNumber.from(x)),
  minStake: nullPassThrough((x: string) => BigNumber.from(x)),
  maxAllocationPercentage: nullPassThrough((x: string) => parseFloat(x)),
  minAverageQueryFees: nullPassThrough((x: string) => BigNumber.from(x)),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
  requireSupported: x => x,
  safety: x => x,
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
  allocationLifetime: nullPassThrough((x: number) => x),
  autoRenewal: x => x,
  parallelAllocations: nullPassThrough((x: number) => x),
  minSignal: nullPassThrough((x: BigNumber) => x.toString()),
  maxSignal: nullPassThrough((x: BigNumber) => x.toString()),
  minStake: nullPassThrough((x: BigNumber) => x.toString()),
  maxAllocationPercentage: nullPassThrough((x: number) => x),
  minAverageQueryFees: nullPassThrough((x: BigNumber) => x.toString()),
  decisionBasis: x => x,
  custom: nullPassThrough(JSON.stringify),
  requireSupported: x => x,
  safety: x => x,
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj[key] = (INDEXING_RULE_PARSERS as any)[key](value)
    } catch {
      throw new Error(key)
    }
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
  outputFormat: OutputFormat,
  rules: Partial<IndexingRuleAttributes>[],
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(rules, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(rules).trim()
    : rules.length === 0
    ? 'No data'
    : table([Object.keys(rules[0]), ...rules.map(rule => Object.values(rule))], {
        border: getBorderCharacters('norc'),
      }).trim()

export const displayIndexingRule = (
  outputFormat: OutputFormat,
  rule: Partial<IndexingRuleAttributes>,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(rule, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(rule).trim()
    : table([Object.keys(rule), Object.values(rule)], {
        border: getBorderCharacters('norc'),
      }).trim()

export const displayRules = (
  outputFormat: OutputFormat,
  identifier: string,
  ruleOrRules: Partial<IndexingRuleAttributes> | Partial<IndexingRuleAttributes>[] | null,
  keys: (keyof IndexingRuleAttributes)[],
): string => {
  if (Array.isArray(ruleOrRules)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules = ruleOrRules.map(rule => formatIndexingRule(pickFields(rule, keys)))

    const onchainRules = rules.filter(
      rule => rule?.decisionBasis !== IndexingDecisionBasis.OFFCHAIN,
    )
    const offchainRules = rules.filter(
      rule => rule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN,
    )

    // Display indexing rules set to sync off-chain if any
    const offchainRulesDisplay = offchainRules.length
      ? [
          chalk.bold('Offchain sync list'),
          offchainRules.map(rule => {
            return rule.identifier
          }),
        ].join('\n')
      : chalk.dim(`Not syncing any subgraphs offchain`)

    return `${displayIndexingRules(outputFormat, onchainRules)}\n${offchainRulesDisplay}`
  } else if (ruleOrRules) {
    const rule = formatIndexingRule(pickFields(ruleOrRules, keys))
    return displayIndexingRule(outputFormat, rule)
  } else if (identifier) {
    return chalk.red(`No rule found for subgraph identifier "${identifier}"`)
  } else {
    return chalk.dim(`No indexing rules found`)
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
            allocationLifetime
            autoRenewal
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
            requireSupported
            safety
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
            allocationLifetime
            autoRenewal
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
            requireSupported
            safety
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
            allocationLifetime
            autoRenewal
            parallelAllocations
            maxAllocationPercentage
            minSignal
            maxSignal
            minStake
            minAverageQueryFees
            custom
            decisionBasis
            requireSupported
            safety
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
  identifiers: string[],
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
