/* eslint-disable @typescript-eslint/ban-types */

import { POIDispute, POIDisputeCreationAttributes } from '../models'
import { IndexerManagementResolverContext } from '../client'

export default {
  dispute: async (
    { allocationID }: { allocationID: number },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const dispute = await models.POIDispute.findOne({
      where: { allocationID },
    })
    // console.log('DISPUTE', dispute)
    return dispute?.toGraphQL() || dispute
  },

  disputes: async (
    _: {},
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const disputes = await models.POIDispute.findAll({
      order: [['allocationAmount', 'DESC']],
    })
    return disputes.map((dispute) => dispute.toGraphQL())
  },

  storeDisputes: async (
    { disputes }: { disputes: POIDisputeCreationAttributes[] },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    // console.log('DISPUTES', disputes)
    const createdDisputes = await models.POIDispute.bulkCreate(disputes, {
      returning: true,
      validate: false,
    })
    // console.log('CREATED', createdDisputes)
    // console.log(
    //   'CREATED GQL',
    //   createdDisputes.map((dispute: POIDispute) => dispute.toGraphQL()),
    // )
    return createdDisputes.map((dispute: POIDispute) => dispute.toGraphQL())
  },

  deleteDisputes: async (
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
  },
}
