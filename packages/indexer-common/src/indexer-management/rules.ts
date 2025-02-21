import { Logger } from '@graphprotocol/common-ts'
import {
  IndexerManagementModels,
  IndexingRule,
  IndexingRuleAttributes,
} from '@graphprotocol/indexer-common'
import { parseIndexingRule } from '../rules'

export const fetchIndexingRules = async (
  models: IndexerManagementModels,
): Promise<IndexingRuleAttributes[]> => {
  // If unspecified, select indexing rules from all protocol networks
  const rules = await models.IndexingRule.findAll({
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  return rules
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
