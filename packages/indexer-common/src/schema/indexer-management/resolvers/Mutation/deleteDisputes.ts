import { validateNetworkIdentifier } from 'indexer-common/src/parsers/validators'
import type { MutationResolvers } from './../../../types.generated'
import groupBy from 'lodash.groupby'

export const deleteDisputes: NonNullable<MutationResolvers['deleteDisputes']> = async (
  _parent,
  { identifiers },
  { models },
) => {
  let totalNumDeleted = 0

  // Sanitize protocol network identifiers
  for (const identifier of identifiers) {
    if (!identifier.protocolNetwork) {
      throw new Error(`Dispute is missing the attribute 'protocolNetwork'`)
    }
    identifier.protocolNetwork = validateNetworkIdentifier(identifier.protocolNetwork)
  }

  // Batch by protocolNetwork
  const batches = groupBy(identifiers, (x) => x.protocolNetwork)

  for (const protocolNetwork in batches) {
    const batch = batches[protocolNetwork]
    const numDeleted = await models.POIDispute.destroy({
      where: {
        allocationID: batch.map((x) => x.allocationID),
      },
      force: true,
    })
    totalNumDeleted += numDeleted
  }
  return totalNumDeleted
}
