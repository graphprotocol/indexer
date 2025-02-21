/* eslint-disable @typescript-eslint/ban-types */

import { POIDispute, POIDisputeCreationAttributes } from '../models'
import { IndexerManagementResolverContext } from '../client'
import { validateNetworkIdentifier } from '../../parsers'
import { Op, WhereOptions } from 'sequelize'

export default {
  dispute: async (
    { identifier }: { identifier: string },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const dispute = await models.POIDispute.findOne({
      where: { allocationID: identifier },
    })
    return dispute?.toGraphQL() || dispute
  },

  disputes: async (
    {
      status,
      minClosedEpoch,
      protocolNetwork: uncheckedProtocolNetwork,
    }: { status: string; minClosedEpoch: number; protocolNetwork: string | undefined },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
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
  },

  storeDisputes: async (
    { disputes }: { disputes: POIDisputeCreationAttributes[] },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const createdDisputes = await models.POIDispute.bulkCreate(disputes, {
      returning: true,
      validate: true,
      updateOnDuplicate: [
        'closedEpochReferenceProof',
        'previousEpochReferenceProof',
        'status',
      ],
      conflictAttributes: ['allocationID'],
    })
    return createdDisputes.map((dispute: POIDispute) => dispute.toGraphQL())
  },

  deleteDisputes: async (
    { identifiers }: { identifiers: string[] },
    { models }: IndexerManagementResolverContext,
  ): Promise<number> => {
    let totalNumDeleted = 0
    const numDeleted = await models.POIDispute.destroy({
      where: {
        allocationID: identifiers,
      },
      force: true,
    })
    totalNumDeleted += numDeleted
    return totalNumDeleted
  },
}
