import type { MutationResolvers } from './../../../types.generated'

// @ts-expect-error need to fix
export const cancelActions: NonNullable<MutationResolvers['cancelActions']> = async (
  _parent,
  { actionIDs },
  { logger, models },
) => {
  logger.debug(`Execute 'cancelActions' mutation`, {
    actionIDs,
  })
  const [, canceledActions] = await models.Action.update(
    { status: 'canceled' },
    { where: { id: actionIDs }, returning: true },
  )

  if (canceledActions.length === 0) {
    throw Error(`Cancel action failed: No action items found with id in [${actionIDs}]`)
  }

  return canceledActions
}
