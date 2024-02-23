import type { MutationResolvers } from './../../../types.generated'

export const updateAction: NonNullable<MutationResolvers['updateAction']> = async (
  _parent,
  { action },
  { logger, models },
) => {
  logger.debug(`Execute 'updateAction' mutation`, {
    action,
  })
  const [, updatedActions] = await models.Action.update(action, {
    where: { id: action.id },
    returning: true,
  })

  if (updatedActions.length === 0) {
    throw Error(
      `Update action failed, are you sure there is an item in the queue with id = ${action.id}`,
    )
  }
  if (updatedActions.length > 1) {
    throw Error(
      `${updatedActions.length} action items updated in the queue. Should be '1'`,
    )
  }
  return updatedActions[0]
}
