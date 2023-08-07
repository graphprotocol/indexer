import { Address } from '@graphprotocol/common-ts'
import { Transaction } from 'sequelize'
import { AllocationSummary, QueryFeeModels } from './models'

export const ensureAllocationSummary = async (
  models: QueryFeeModels,
  allocation: Address,
  transaction: Transaction,
  protocolNetwork: string,
): Promise<[AllocationSummary, boolean]> => {
  const [summary, isNew] = await models.allocationSummaries.findOrBuild({
    where: { allocation },
    defaults: {
      allocation,
      closedAt: null,
      createdTransfers: 0,
      resolvedTransfers: 0,
      failedTransfers: 0,
      openTransfers: 0,
      collectedFees: '0',
      withdrawnFees: '0',
      protocolNetwork,
    },
    transaction,
  })
  return [summary, isNew]
}
