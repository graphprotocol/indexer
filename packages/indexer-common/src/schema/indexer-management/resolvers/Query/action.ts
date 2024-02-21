import type { QueryResolvers } from './../../../types.generated'
export const action: NonNullable<QueryResolvers['action']> = async (
  _parent,
  { actionID },
  { logger, models },
) => {
  logger.debug(`Execute 'action' query`, {
    actionID,
  })
  return models.Action.findOne({
    where: { id: actionID },
  })
}
