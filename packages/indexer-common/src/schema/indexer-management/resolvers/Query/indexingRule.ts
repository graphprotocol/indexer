import { processIdentifier } from 'indexer-common/src/subgraphs'
import type { QueryResolvers } from './../../../types.generated'
import { validateNetworkIdentifier } from 'indexer-common/src/parsers/validators'
import { INDEXING_RULE_GLOBAL } from 'indexer-common/src/indexer-management/models/indexing-rule'

export const indexingRule: NonNullable<QueryResolvers['indexingRule']> = async (
  _parent,
  { identifier: indexingRuleIdentifier, merged },
  { models },
) => {
  const [identifier] = await processIdentifier(indexingRuleIdentifier.identifier, {
    all: false,
    global: true,
  })

  // Sanitize protocol network identifier
  const protocolNetwork = validateNetworkIdentifier(
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
}
