import { validateNetworkIdentifier } from '../../../../parsers/validators'
import { fetchIndexingRules } from '../../../../indexer-management/rules'
import type { QueryResolvers } from './../../../types.generated'

export const indexingRules: NonNullable<QueryResolvers['indexingRules']> = async (
  _parent,
  { merged, protocolNetwork: uncheckedProtocolNetwork },
  { models },
) => {
  // Convert the input `protocolNetwork` value to a CAIP2-ID
  const protocolNetwork = uncheckedProtocolNetwork
    ? validateNetworkIdentifier(uncheckedProtocolNetwork)
    : undefined
  const rules = await fetchIndexingRules(models, merged, protocolNetwork)
  return rules.map((r) => r.toGraphQL())
}
