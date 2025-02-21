/* eslint-disable @typescript-eslint/ban-types */

import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRuleCreationAttributes,
} from '../models'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from '../client'
import { Transaction } from 'sequelize/types'
import { fetchIndexingRules } from '../rules'
import { processIdentifier } from '../../'
import { validateNetworkIdentifier } from '../../parsers'

const resetGlobalRule = async (
  ruleIdentifier: string,
  defaults: IndexerManagementDefaults['globalIndexingRule'],
  models: IndexerManagementModels,
  transaction: Transaction,
) => {
  await models.IndexingRule.upsert(
    {
      ...defaults,
      identifier: ruleIdentifier,
      allocationAmount: defaults.allocationAmount.toString(),
    },
    { transaction },
  )
}

export default {
  indexingRule: async (
    {
      identifier: indexingRuleIdentifier,
      merged,
    }: { identifier: string; merged: boolean },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier, {
      all: false,
      global: true,
    })

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
    _: {},
    { models }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    return await fetchIndexingRules(models)
  },

  setIndexingRule: async (
    { rule }: { rule: IndexingRuleCreationAttributes },
    { models }: IndexerManagementResolverContext,
  ): Promise<object> => {
    if (!rule.identifier) {
      throw Error('Cannot set indexingRule without identifier')
    }

    if (!rule.protocolNetwork) {
      throw Error("Cannot set an indexing rule without the field 'protocolNetwork'")
    } else {
      try {
        rule.protocolNetwork = validateNetworkIdentifier(rule.protocolNetwork)
      } catch (e) {
        throw Error(`Invalid value for the field 'protocolNetwork'. ${e}`)
      }
    }

    const [identifier] = await processIdentifier(rule.identifier, {
      all: false,
      global: true,
    })
    rule.identifier = identifier

    const [updatedRule] = await models.IndexingRule.upsert(rule)
    return updatedRule.toGraphQL()
  },

  deleteIndexingRule: async (
    { identifier: indexingRuleIdentifier }: { identifier: string },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier, {
      all: false,
      global: true,
    })

    const whereClause = { identifier }

    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: whereClause,
        transaction,
      })

      if (whereClause.identifier === 'global') {
        await resetGlobalRule(
          whereClause.identifier,
          defaults.globalIndexingRule,
          models,
          transaction,
        )
      }

      return numDeleted > 0
    })
  },

  deleteIndexingRules: async (
    { identifiers: indexingRuleIdentifiers }: { identifiers: string[] },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const identifiers = await Promise.all(
      indexingRuleIdentifiers.map(
        async (identifier: string) =>
          (await processIdentifier(identifier, { all: false, global: true }))[0],
      ),
    )

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
