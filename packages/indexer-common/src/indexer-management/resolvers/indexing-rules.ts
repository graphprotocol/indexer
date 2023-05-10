/* eslint-disable @typescript-eslint/ban-types */

import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRuleIdentifier,
  IndexingRuleCreationAttributes,
} from '../models'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from '../client'
import { Transaction } from 'sequelize/types'
import { fetchIndexingRules } from '../rules'
import { processIdentifier } from '../../'
import { validateNetworkIdentifier } from '../../parsers'

const resetGlobalRule = async (
  ruleIdentifier: IndexingRuleIdentifier,
  defaults: IndexerManagementDefaults['globalIndexingRule'],
  models: IndexerManagementModels,
  transaction: Transaction,
) => {
  await models.IndexingRule.upsert(
    {
      ...defaults,
      ...ruleIdentifier,
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
    }: { identifier: IndexingRuleIdentifier; merged: boolean },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })
    const validatedIdentifier = {
      ...indexingRuleIdentifier,
      identifier: identifier,
    }

    const rule = await models.IndexingRule.findOne({
      where: validatedIdentifier,
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

    if (!rule.protocolNetwork) {
      throw Error('Cannot set indexingRule without protocolNetwork')
    } else {
      try {
        validateNetworkIdentifier(rule.protocolNetwork)
      } catch (e) {
        throw Error(`Invalid protocolNetwork. ${e}`)
      }
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
    { identifier: indexingRuleIdentifier }: { identifier: IndexingRuleIdentifier },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })
    const validatedRuleIdentifier = {
      ...indexingRuleIdentifier,
      identifier,
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: {
          ...validatedRuleIdentifier,
        },
        transaction,
      })

      // Reset the global rule
      if (validatedRuleIdentifier.identifier === 'global') {
        await resetGlobalRule(
          validatedRuleIdentifier,
          defaults.globalIndexingRule,
          models,
          transaction,
        )
      }

      return numDeleted > 0
    })
  },

  deleteIndexingRules: async (
    { identifiers: indexingRuleIdentifiers }: { identifiers: IndexingRuleIdentifier[] },
    { models, defaults }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    let totalNumDeleted = 0
    // Batch deletions by the `IndexingRuleIdentifier.protocolNetwork` attribute .
    const batches = indexingRuleIdentifiers.reduce((acc, rule) => {
      if (!acc[rule.protocolNetwork]) {
        acc[rule.protocolNetwork] = []
      }
      acc[rule.protocolNetwork].push(rule.identifier)
      return acc
    }, {} as Record<string, string[]>)

    for (const protocolNetwork in batches) {
      const batch = batches[protocolNetwork]
      const identifiers = await Promise.all(
        batch.map(
          async (identifier: string) =>
            (
              await processIdentifier(identifier, { all: false, global: true })
            )[0],
        ),
      )
      // Execute deletion batch
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await models.IndexingRule.sequelize!.transaction(async (transaction) => {
        const numDeleted = await models.IndexingRule.destroy({
          where: {
            identifier: identifiers,
            protocolNetwork: protocolNetwork,
          },
          transaction,
        })

        if (identifiers.includes('global')) {
          const globalIdentifier = { identifier: 'global', protocolNetwork }
          await resetGlobalRule(
            globalIdentifier,
            defaults.globalIndexingRule,
            models,
            transaction,
          )
        }
        totalNumDeleted += numDeleted
      })
    }
    return totalNumDeleted > 0
  },
}
