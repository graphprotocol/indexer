import { Logger } from '@graphprotocol/common-ts'
import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRule,
  IndexingRuleAttributes,
} from '@graphprotocol/indexer-common'
import { parseIndexingRule } from '../rules'

export const fetchIndexingRules = async (
  models: IndexerManagementModels,
  merged: boolean,
  protocolNetwork: string,
): Promise<IndexingRuleAttributes[]> => {
  const rules = await models.IndexingRule.findAll({
    where: { protocolNetwork },
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  if (merged) {
    const global = await models.IndexingRule.findOne({
      where: { identifier: INDEXING_RULE_GLOBAL, protocolNetwork },
    })
    return rules.map((rule) => rule.mergeGlobal(global))
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
