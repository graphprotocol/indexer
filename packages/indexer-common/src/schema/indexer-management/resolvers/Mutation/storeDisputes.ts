import { validateNetworkIdentifier } from '../../../../parsers/validators'
import type { MutationResolvers } from './../../../types.generated'

export const storeDisputes: NonNullable<MutationResolvers['storeDisputes']> = async (
  _parent,
  { disputes },
  { models },
) => {
  // Sanitize protocol network identifiers
  for (const dispute of disputes) {
    if (!dispute.protocolNetwork) {
      throw new Error(`Dispute is missing the attribute 'protocolNetwork'`)
    }
    dispute.protocolNetwork = validateNetworkIdentifier(dispute.protocolNetwork)
  }

  const createdDisputes = await models.POIDispute.bulkCreate(disputes, {
    returning: true,
    validate: true,
    updateOnDuplicate: [
      'closedEpochReferenceProof',
      'previousEpochReferenceProof',
      'status',
    ],
    conflictAttributes: ['allocationID', 'protocolNetwork'],
  })
  return createdDisputes.map((dispute) => dispute.toGraphQL())
}
