import { validateNetworkIdentifier } from '../../../../parsers/validators'
import type { MutationResolvers } from './../../../types.generated'
import { processIdentifier } from '../../../../subgraphs'

export const setIndexingRule: NonNullable<MutationResolvers['setIndexingRule']> = async (
  _parent,
  { rule },
  { models },
) => {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [updatedRule, _created] = await models.IndexingRule.upsert(rule)
  return updatedRule.toGraphQL()
}