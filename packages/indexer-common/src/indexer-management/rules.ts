import { Logger } from '@tokene-q/common-ts'
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
): Promise<IndexingRuleAttributes[]> => {
  const rules = await models.IndexingRule.findAll({
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  if (merged) {
    const global = await models.IndexingRule.findOne({
      where: { identifier: INDEXING_RULE_GLOBAL },
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
  await models.IndexingRule.upsert(indexingRule)

  // Since upsert succeeded, we _must_ have a rule
  const updatedRule = await models.IndexingRule.findOne({
    where: { identifier: indexingRule.identifier },
  })

  logger.debug(
    `DecisionBasis.${indexingRule.decisionBasis} rule merged into indexing rules`,
    {
      rule: updatedRule,
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return updatedRule!
}
