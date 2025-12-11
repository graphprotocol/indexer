/* eslint-disable @typescript-eslint/ban-types */

import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRuleIdentifier,
  IndexingRuleCreationAttributes,
} from '../models'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from '../client'
import { Transaction } from 'sequelize'
import { fetchIndexingRules } from '../rules'
import { ensureAllocationLifetime, processIdentifier } from '../../'
import groupBy from 'lodash.groupby'
import { getNetwork, getProtocolNetwork } from './utils'

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
    context: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const { models } = context
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })

    // Get protocol network from context or provided value
    const protocolNetwork = getProtocolNetwork(
      context,
      indexingRuleIdentifier.protocolNetwork,
    )

    const rule = await models.IndexingRule.findOne({
      where: { identifier, protocolNetwork },
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
    {
      merged,
      protocolNetwork: uncheckedProtocolNetwork,
    }: { merged: boolean; protocolNetwork: string | undefined },
    context: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const { models } = context
    // Get protocol network from context or provided value
    const protocolNetwork = getProtocolNetwork(context, uncheckedProtocolNetwork)
    return await fetchIndexingRules(models, merged, protocolNetwork)
  },

  setIndexingRule: async (
    { rule }: { rule: IndexingRuleCreationAttributes },
    context: IndexerManagementResolverContext,
  ): Promise<object> => {
    const { models } = context
    if (!rule.identifier) {
      throw Error('Cannot set indexingRule without identifier')
    }

    // Get protocol network from context or provided value
    rule.protocolNetwork = getProtocolNetwork(context, rule.protocolNetwork)

    const network = getNetwork(context, rule.protocolNetwork)

    const [isValid, maxSuggestedLifetime] = await ensureAllocationLifetime(rule, network)
    if (!isValid) {
      throw Error(
        `Allocation lifetime must be at most ${maxSuggestedLifetime} epochs, otherwise indexing rewards will be forefited.`,
      )
    }

    const [identifier] = await processIdentifier(rule.identifier, {
      all: false,
      global: true,
    })
    rule.identifier = identifier

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [updatedRule, _created] = await models.IndexingRule.upsert(rule)
    return updatedRule.toGraphQL()
  },

  deleteIndexingRule: async (
    { identifier: indexingRuleIdentifier }: { identifier: IndexingRuleIdentifier },
    context: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const { models, defaults } = context
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })

    // Get protocol network from context or provided value
    const protocolNetwork = getProtocolNetwork(
      context,
      indexingRuleIdentifier.protocolNetwork,
    )

    const validatedRuleIdentifier = {
      protocolNetwork,
      identifier,
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.IndexingRule.sequelize!.transaction(async (transaction) => {
      const numDeleted = await models.IndexingRule.destroy({
        where: validatedRuleIdentifier,
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
    context: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const { models, defaults } = context
    let totalNumDeleted = 0

    // Normalize protocol network identifiers - use context network if not provided
    for (const identifier of indexingRuleIdentifiers) {
      identifier.protocolNetwork = getProtocolNetwork(context, identifier.protocolNetwork)
    }

    // Batch deletions by the `IndexingRuleIdentifier.protocolNetwork` attribute .
    const batches = groupBy(
      indexingRuleIdentifiers,
      (x: IndexingRuleIdentifier) => x.protocolNetwork,
    )

    for (const protocolNetwork in batches) {
      const batch = batches[protocolNetwork]
      const identifiers = await Promise.all(
        batch.map(
          async ({ identifier }: IndexingRuleIdentifier) =>
            (await processIdentifier(identifier, { all: false, global: true }))[0],
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
