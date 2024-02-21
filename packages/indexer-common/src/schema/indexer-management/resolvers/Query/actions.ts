import type { QueryResolvers } from './../../../types.generated'
import { actionFilterToWhereOptions } from 'indexer-common/src/actions'
import { Order } from 'sequelize'

export const actions: NonNullable<QueryResolvers['actions']> = async (
  _parent,
  { filter, orderBy, orderDirection, first },
  { logger, models },
) => {
  logger.debug(`Execute 'actions' query`, {
    filter,
    orderBy,
    orderDirection,
    first,
  })

  const orderObject: Order = orderBy
    ? [[orderBy.toString(), orderDirection ?? 'desc']]
    : [['id', 'desc']]

  return models.Action.findAll({
    where: actionFilterToWhereOptions(filter || {}),
    order: orderObject,
    limit: first || undefined,
  })
}
