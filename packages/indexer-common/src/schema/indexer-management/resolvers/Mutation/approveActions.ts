import { type MutationResolvers } from './../../../types.generated'

// @ts-expect-error it be like that
export const approveActions: NonNullable<MutationResolvers['approveActions']> = async (
  _parent,
  { actionIDs },
  { logger, models },
) => {
  logger.debug(`Execute 'approveActions' mutation`, {
    actionIDs,
  })
  const [, updatedActions] = await models.Action.update(
    { status: 'approved' },
    { where: { id: actionIDs }, returning: true },
  )

  if (updatedActions.length === 0) {
    throw Error(`Approve action failed: No action items found with id in [${actionIDs}]`)
  }

  return updatedActions
}
