/* eslint-disable @typescript-eslint/ban-types */

import { POIDispute, POIDisputeIdentifier, POIDisputeCreationAttributes } from '../models'
import { IndexerManagementResolverContext } from '../client'
import { Op, WhereOptions } from 'sequelize'
import groupBy from 'lodash.groupby'
import { getProtocolNetwork } from './utils'

export default {
  dispute: async (
    { identifier }: { identifier: POIDisputeIdentifier },
    context: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const { models } = context
    // Get protocol network from context or provided value
    const protocolNetwork = getProtocolNetwork(context, identifier.protocolNetwork)
    const dispute = await models.POIDispute.findOne({
      where: { allocationID: identifier.allocationID, protocolNetwork },
    })
    return dispute?.toGraphQL() || dispute
  },

  disputes: async (
    {
      status,
      minClosedEpoch,
      protocolNetwork: uncheckedProtocolNetwork,
    }: { status: string; minClosedEpoch: number; protocolNetwork: string | undefined },
    context: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const { models } = context
    // Get protocol network from context or provided value
    const protocolNetwork = getProtocolNetwork(context, uncheckedProtocolNetwork)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlAndExpression: WhereOptions<any> = [
      { status },
      { closedEpoch: { [Op.gte]: minClosedEpoch } },
      { protocolNetwork },
    ]

    const disputes = await models.POIDispute.findAll({
      where: { [Op.and]: sqlAndExpression },
      order: [['allocationAmount', 'DESC']],
    })
    return disputes.map((dispute) => dispute.toGraphQL())
  },

  storeDisputes: async (
    { disputes }: { disputes: POIDisputeCreationAttributes[] },
    context: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const { models } = context
    // Normalize protocol network identifiers - use context network if not provided
    for (const dispute of disputes) {
      dispute.protocolNetwork = getProtocolNetwork(context, dispute.protocolNetwork)
    }

    const createdDisputes = await models.POIDispute.bulkCreate(disputes, {
      returning: true,
      validate: true,
      updateOnDuplicate: [
        'closedEpochReferenceProof',
        'previousEpochReferenceProof',
        'status',
      ],
      conflictAttributes: ['allocationID', 'protocolNetwork'],
    })
    return createdDisputes.map((dispute: POIDispute) => dispute.toGraphQL())
  },

  deleteDisputes: async (
    { identifiers }: { identifiers: POIDisputeIdentifier[] },
    context: IndexerManagementResolverContext,
  ): Promise<number> => {
    const { models } = context
    let totalNumDeleted = 0

    // Normalize protocol network identifiers - use context network if not provided
    for (const identifier of identifiers) {
      identifier.protocolNetwork = getProtocolNetwork(context, identifier.protocolNetwork)
    }

    // Batch by protocolNetwork
    const batches = groupBy(identifiers, (x: POIDisputeIdentifier) => x.protocolNetwork)

    for (const protocolNetwork in batches) {
      const batch = batches[protocolNetwork]
      const numDeleted = await models.POIDispute.destroy({
        where: {
          allocationID: batch.map((x) => x.allocationID),
        },
        force: true,
      })
      totalNumDeleted += numDeleted
    }
    return totalNumDeleted
  },
}
