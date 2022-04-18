/* eslint-disable @typescript-eslint/ban-types */

import { POIDispute, POIDisputeCreationAttributes } from '../models'
import { IndexerManagementResolverContext } from '../client'
import { Op } from 'sequelize'

export const dispute = async (
  { allocationID }: { allocationID: number },
  { models }: IndexerManagementResolverContext,
): Promise<object | null> => {
  const dispute = await models.POIDispute.findOne({
    where: { allocationID },
  })
  return dispute?.toGraphQL() || dispute
}

export const disputes = async (
  { status, minClosedEpoch }: { status: string; minClosedEpoch: number },
  { models }: IndexerManagementResolverContext,
): Promise<object | null> => {
  const disputes = await models.POIDispute.findAll({
    where: {
      [Op.and]: [
        { status },
        {
          closedEpoch: {
            [Op.gte]: minClosedEpoch,
          },
        },
      ],
    },
    order: [['allocationAmount', 'DESC']],
  })
  return disputes.map((dispute) => dispute.toGraphQL())
}

export const storeDisputes = async (
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
  })
  return createdDisputes.map((dispute: POIDispute) => dispute.toGraphQL())
}

export const deleteDisputes = async (
  { allocationIDs }: { allocationIDs: string[] },
  { models }: IndexerManagementResolverContext,
): Promise<number> => {
  const numDeleted = await models.POIDispute.destroy({
    where: {
      allocationID: allocationIDs,
    },
    force: true,
  })
  return numDeleted
}
