import { processIdentifier } from '../../../../subgraphs'
import type { MutationResolvers } from './../../../types.generated'
import { validateNetworkIdentifier } from '../../../../parsers/validators'
import { resetGlobalRule } from '../../../../indexer-management/resolvers/indexing-rules'

export const deleteIndexingRule: NonNullable<MutationResolvers['deleteIndexingRule']> = async (_parent, { identifier: indexingRuleIdentifier }, { models, defaults }) => {
  const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
    all: false,
    global: true,
  })

  // Sanitize protocol network identifier
  const protocolNetwork = validateNetworkIdentifier(
    indexingRuleIdentifier.protocolNetwork,
  )

  const validatedRuleIdentifier = {
    protocolNetwork,
    identifier,
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return models.IndexingRule.sequelize!.transaction(async (transaction) => {
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
}
