import { ActionManager } from '../../../../indexer-management/actions'
import type { MutationResolvers } from './../../../types.generated'

export const updateActions: NonNullable<MutationResolvers['updateActions']> = async (
  _parent,
  { filter, action },
  { logger, models },
) => {
  logger.debug(`Execute 'updateActions' mutation`, {
    filter,
    action,
  })

  const results = await ActionManager.updateActions(models, action, filter)

  if (results[0] === 0) {
    const msg = `Actions update failed: No action was matched by the filter, '${JSON.stringify(
      filter,
    )}'`
    logger.debug(msg)
    throw Error(msg)
  }
  logger.info(`'${results[0]}' actions updated`)
  const response = results[1]

  return response
}
