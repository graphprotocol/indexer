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
import { processIdentifier, validateNetworkIdentifier } from '../../'
import groupBy from 'lodash.groupby'

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
    { models, network }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })

    const protocolNetwork = network.networkMonitor.networkCAIPID

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
    { merged }: { merged: boolean; protocolNetwork: string | undefined },
    { models, network }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const protocolNetwork = network.networkMonitor.networkCAIPID
    return await fetchIndexingRules(models, merged, protocolNetwork)
  },

  setIndexingRule: async (
    { rule }: { rule: IndexingRuleCreationAttributes },
    { models, network }: IndexerManagementResolverContext,
  ): Promise<object> => {
    if (!rule.identifier) {
      throw Error('Cannot set indexingRule without identifier')
    }

    if (
      rule.protocolNetwork &&
      validateNetworkIdentifier(rule.protocolNetwork) !==
        network.specification.networkIdentifier
    ) {
      throw Error(
        `Cannot set indexingRule for a different network (${rule.protocolNetwork}) than configured ${network.specification.networkIdentifier}`,
      )
    }

    rule.protocolNetwork = network.specification.networkIdentifier

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
    { models, defaults, network }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
      all: false,
      global: true,
    })

    const protocolNetwork = network.networkMonitor.networkCAIPID

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
    { models, defaults, network }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    let totalNumDeleted = 0

    // Sanitize protocol network identifiers
    for (const identifier of indexingRuleIdentifiers) {
      identifier.protocolNetwork = network.networkMonitor.networkCAIPID
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
