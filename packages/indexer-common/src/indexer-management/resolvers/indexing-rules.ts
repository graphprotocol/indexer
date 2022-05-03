/* eslint-disable @typescript-eslint/ban-types */

import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRuleCreationAttributes,
} from '../models'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from '../client'
import { Transaction } from 'sequelize/types'
import { fetchIndexingRules, processIdentifier } from '@graphprotocol/indexer-common'

const resetGlobalRule = async (
  identifier: string,
  defaults: IndexerManagementDefaults['globalIndexingRule'],
  models: IndexerManagementModels,
  transaction: Transaction,
) => {
  await models.IndexingRule.upsert(
    {
      ...defaults,
      allocationAmount: defaults.allocationAmount.toString(),
      identifier,
    },
    { transaction },
  )
}

export default {
  indexingRule: async (
    { identifier, merged }: { identifier: string; merged: boolean },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    ;[identifier] = await processIdentifier(identifier, { all: false, global: true })
    const rule = await models.IndexingRule.findOne({
      where: { identifier },
    })
    if (rule && merged) {
      return rule.mergeToGraphQL(
        await models.IndexingRule.findOne({
          where: { identifier: INDEXING_RULE_GLOBAL },
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
    return await fetchIndexingRules(models, merged)
  },

  setIndexingRule: async (
    { rule }: { rule: IndexingRuleCreationAttributes },
    { models }: IndexerManagementResolverContext,
  ): Promise<object> => {
    if (!rule.identifier) {
      throw Error('Cannot set indexingRule without identifier')
    }

    const [identifier] = await processIdentifier(rule.identifier, {
      all: false,
      global: true,
    })
    rule.identifier = identifier

    await models.IndexingRule.upsert(rule)

    // Since upsert succeeded, we _must_ have a rule
    const updatedRule = await models.IndexingRule.findOne({
      where: { identifier: rule.identifier },
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return updatedRule!.toGraphQL()
  },

  deleteIndexingRule: async (
    { identifier }: { identifier: string },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    ;[identifier] = await processIdentifier(identifier, { all: false, global: true })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: {
          identifier,
        },
        transaction,
      })

      // Reset the global rule
      if (identifier === 'global') {
        await resetGlobalRule(
          identifier,
          defaults.globalIndexingRule,
          models,
          transaction,
        )
      }

      return numDeleted > 0
    })
  },

  deleteIndexingRules: async (
    { identifiers }: { identifiers: string[] },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    identifiers = await Promise.all(
      identifiers.map(
        async (identifier) =>
          (
            await processIdentifier(identifier, { all: false, global: true })
          )[0],
      ),
    )

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: {
          identifier: identifiers,
        },
        transaction,
      })

      if (identifiers.includes('global')) {
        await resetGlobalRule('global', defaults.globalIndexingRule, models, transaction)
      }

      return numDeleted > 0
    })
  },
}
