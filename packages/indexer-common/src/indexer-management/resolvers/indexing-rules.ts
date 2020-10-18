/* eslint-disable @typescript-eslint/ban-types */

import {
  IndexerManagementModels,
  IndexingRuleCreationAttributes,
  INDEXING_RULE_GLOBAL,
} from '../models'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from '../client'
import { Transaction } from 'sequelize/types'

const resetGlobalRule = async (
  deployment: string,
  defaults: IndexerManagementDefaults['globalIndexingRule'],
  models: IndexerManagementModels,
  transaction: Transaction,
) => {
  await models.IndexingRule.upsert(
    {
      ...defaults,
      allocationAmount: defaults.allocationAmount.toString(),
      deployment,
    },
    { transaction },
  )
}

export default {
  indexingRule: async (
    { deployment, merged }: { deployment: string; merged: boolean },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const rule = await models.IndexingRule.findOne({
      where: { deployment },
    })
    if (rule && merged) {
      return rule.mergeToGraphQL(
        await models.IndexingRule.findOne({
          where: { deployment: INDEXING_RULE_GLOBAL },
        }),
      )
    } else {
      return rule?.toGraphQL() || null
    }
  },

  indexingRules: async (
    { merged }: { merged: boolean },
    { models }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const rules = await models.IndexingRule.findAll({
      order: [['deployment', 'DESC']],
    })
    if (merged) {
      const global = await models.IndexingRule.findOne({
        where: { deployment: INDEXING_RULE_GLOBAL },
      })
      return rules.map((rule) => rule.mergeToGraphQL(global))
    } else {
      return rules.map((rule) => rule.toGraphQL())
    }
  },

  setIndexingRule: async (
    { rule }: { rule: IndexingRuleCreationAttributes },
    { models }: IndexerManagementResolverContext,
  ): Promise<object> => {
    await models.IndexingRule.upsert(rule)

    // Since upsert succeeded, we _must_ have a rule
    const updatedRule = await models.IndexingRule.findOne({
      where: { deployment: rule.deployment },
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return updatedRule!.toGraphQL()
  },

  deleteIndexingRule: async (
    { deployment }: { deployment: string },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: {
          deployment,
        },
        transaction,
      })

      // Reset the global rule
      if (deployment === 'global') {
        await resetGlobalRule(
          deployment,
          defaults.globalIndexingRule,
          models,
          transaction,
        )
      }

      return numDeleted > 0
    })
  },

  deleteIndexingRules: async (
    { deployments }: { deployments: string[] },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: {
          deployment: deployments,
        },
        transaction,
      })

      if (deployments.includes('global')) {
        await resetGlobalRule('global', defaults.globalIndexingRule, models, transaction)
      }

      return numDeleted > 0
    })
  },
}
