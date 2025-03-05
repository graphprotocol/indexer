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
): Promise<IndexingRuleAttributes[]> => {
  // If unspecified, select indexing rules from all protocol networks
  const logger = new Logger({ name: 'indexer-common' })

  logger.info(`Fetching indexing rules for current network `)
  const whereClause = {} // protocolNetwork ?{ protocolNetwork }: {}
  const rules = await models.IndexingRule.findAll({
    where: whereClause,
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  if (merged) {
    // Merge global rule into all rules
    const global = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)
    if (!global) {
      throw Error(`Could not find global rule for current network`)
    }
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
