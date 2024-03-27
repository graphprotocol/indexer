import { validateNetworkIdentifier } from '../../../../parsers/validators'
import type { MutationResolvers } from './../../../types.generated'
import groupBy from 'lodash.groupby'
import { processIdentifier } from '../../../../subgraphs'
import { resetGlobalRule } from '../../../../indexer-management/resolvers/indexing-rules'

export const deleteIndexingRules: NonNullable<
  MutationResolvers['deleteIndexingRules']
> = async (_parent, { identifiers: indexingRuleIdentifiers }, { models, defaults }) => {
  let totalNumDeleted = 0

  // Sanitize protocol network identifiers
  for (const identifier of indexingRuleIdentifiers) {
    identifier.protocolNetwork = validateNetworkIdentifier(identifier.protocolNetwork)
  }

  // Batch deletions by the `IndexingRuleIdentifier.protocolNetwork` attribute .
  const batches = groupBy(indexingRuleIdentifiers, (x) => x.protocolNetwork)

  for (const protocolNetwork in batches) {
    const batch = batches[protocolNetwork]
    const identifiers = await Promise.all(
      batch.map(
        async ({ identifier }) =>
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
}
