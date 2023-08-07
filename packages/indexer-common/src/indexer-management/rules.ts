import { Logger } from '@graphprotocol/common-ts'
import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRule,
  IndexingRuleAttributes,
} from '@graphprotocol/indexer-common'
import { parseIndexingRule } from '../rules'
import groupBy from 'lodash.groupby'

export const fetchIndexingRules = async (
  models: IndexerManagementModels,
  merged: boolean,
  protocolNetwork?: string,
): Promise<IndexingRuleAttributes[]> => {
  // If unspecified, select indexing rules from all protocol networks
  const whereClause = protocolNetwork ? { protocolNetwork } : {}
  const rules = await models.IndexingRule.findAll({
    where: whereClause,
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  if (merged) {
    // Merge rules by protocol network
    return Object.entries(groupBy(rules, (rule) => rule.protocolNetwork))
      .map(([protocolNetwork, rules]) => {
        const global = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)
        if (!global) {
          throw Error(`Could not find global rule for network '${protocolNetwork}'`)
        }
        return rules.map((rule) => rule.mergeGlobal(global))
      })
      .flat()
  } else {
    return rules
  }
}

export const upsertIndexingRule = async (
  logger: Logger,
  models: IndexerManagementModels,
  newRule: Partial<IndexingRuleAttributes>,
): Promise<IndexingRule> => {
  const indexingRule = parseIndexingRule(newRule)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [updatedRule, _created] = await models.IndexingRule.upsert(indexingRule)

  logger.debug(
    `DecisionBasis.${indexingRule.decisionBasis} rule merged into indexing rules`,
    {
      rule: updatedRule,
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return updatedRule!
}
