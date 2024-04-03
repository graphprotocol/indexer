import { Op, WhereOptions } from 'sequelize'
import type { QueryResolvers } from './../../../types.generated'
import { validateNetworkIdentifier } from '../../../../parsers/validators'

export const disputes: NonNullable<QueryResolvers['disputes']> = async (
  _parent,
  { protocolNetwork: uncheckedProtocolNetwork, status, minClosedEpoch },
  { models },
) => {
  // Sanitize protocol network identifier
  const protocolNetwork = uncheckedProtocolNetwork
    ? validateNetworkIdentifier(uncheckedProtocolNetwork)
    : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlAndExpression: WhereOptions<any> = [
    { status },
    { closedEpoch: { [Op.gte]: minClosedEpoch } },
  ]

  if (protocolNetwork) {
    sqlAndExpression.push({ protocolNetwork })
  }

  const disputes = await models.POIDispute.findAll({
    where: { [Op.and]: sqlAndExpression },
    order: [['allocationAmount', 'DESC']],
  })
  return disputes.map((dispute) => dispute.toGraphQL())
}
