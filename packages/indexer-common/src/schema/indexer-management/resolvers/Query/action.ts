import type { QueryResolvers } from './../../../types.generated'

export const action: NonNullable<QueryResolvers['action']> = async (
  _parent,
  { actionID },
  { logger, models },
) => {
  logger.debug(`Execute 'action' query`, {
    actionID,
  })

  const action = await models.Action.findOne({
    where: { id: actionID },
  })

  return action?.toGraphQL() ?? null
}
