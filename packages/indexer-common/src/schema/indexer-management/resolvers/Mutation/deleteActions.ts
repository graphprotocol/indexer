import type { MutationResolvers } from './../../../types.generated'

export const deleteActions: NonNullable<MutationResolvers['deleteActions']> = async (
  _parent,
  { actionIDs },
  { logger, models },
) => {
  logger.debug(`Execute 'deleteActions' mutation`, {
    actionIDs,
  })
  const numDeleted = await models.Action.destroy({ where: { id: actionIDs } })

  if (numDeleted === 0) {
    throw Error(`Delete action failed: No action items found with id in [${actionIDs}]`)
  }

  return numDeleted
}
