import { IndexingDecisionBasis, IndexingRuleAttributes } from './indexer-management'
import { nullPassThrough, parseBoolean } from './utils'
import { parseGRT } from '@tokene-q/common-ts'

export const parseDecisionBasis = (s: string): IndexingDecisionBasis => {
  if (!['always', 'never', 'rules', 'offchain'].includes(s)) {
    throw new Error(
      `Unknown decision basis "${s}". Supported: always, never, rules, offchain`,
    )
  } else {
    return s as IndexingDecisionBasis
  }
}

// TODO: Merge with parsers in indexer-cli/src/rules.ts
const INDEXING_RULE_READABLE_TO_MODEL_PARSERS: Record<
  keyof IndexingRuleAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: (x) => x,
  identifier: (x) => x,
  identifierType: (x) => x,
  allocationAmount: (x: string) => parseGRT(x).toString(),
  allocationLifetime: nullPassThrough(parseInt),
  autoRenewal: nullPassThrough(parseBoolean),
  parallelAllocations: nullPassThrough(parseInt),
  minSignal: nullPassThrough((x: string) => parseGRT(x).toString()),
  maxSignal: nullPassThrough((x: string) => parseGRT(x).toString()),
  minStake: nullPassThrough((x: string) => parseGRT(x).toString()),
  maxAllocationPercentage: nullPassThrough(parseFloat),
  minAverageQueryFees: nullPassThrough((x: string) => parseGRT(x).toString()),
  decisionBasis: nullPassThrough(parseDecisionBasis),
  custom: nullPassThrough(JSON.parse),
  requireSupported: (x) => parseBoolean(x),
  safety: (x) => parseBoolean(x),
}

export const parseIndexingRule = (
  rule: Partial<IndexingRuleAttributes>,
): Partial<IndexingRuleAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(rule)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj[key] = (INDEXING_RULE_READABLE_TO_MODEL_PARSERS as any)[key](value)
    } catch {
      throw new Error(key)
    }
  }
  return obj as Partial<IndexingRuleAttributes>
}
