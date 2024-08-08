import { extractNetwork } from '../utils'
import {
  IdentifierType,
  IndexingDecisionBasis,
  type MutationResolvers,
} from './../../../types.generated'
import { IndexerErrorCode, indexerError } from '../../../../errors'
import { formatGRT } from '@graphprotocol/common-ts'

export const closeAllocation: NonNullable<MutationResolvers['closeAllocation']> = async (
  _parent,
  { protocolNetwork, allocation, poi, force },
  { multiNetworks, logger, models },
) => {
  logger.debug('Execute closeAllocation() mutation', {
    allocationID: allocation,
    poi: poi || 'none provided',
  })
  if (!multiNetworks) {
    throw Error('IndexerManagementClient must be in `network` mode to fetch allocations')
  }
  const network = extractNetwork(protocolNetwork, multiNetworks)
  const networkMonitor = network.networkMonitor
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const receiptCollector = network.receiptCollector

  const allocationData = await networkMonitor.allocation(allocation)

  try {
    poi = await networkMonitor.resolvePOI(
      allocationData,
      poi || undefined,
      Boolean(force),
    )

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized }
    //
    // in the contracts.
    const state = await contracts.staking.getAllocationState(allocationData.id)
    if (state !== 1) {
      throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
    }

    logger.debug('Sending closeAllocation transaction')
    const receipt = await transactionManager.executeTransaction(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      () => contracts.staking.estimateGas.closeAllocation(allocationData.id, poi!),
      (gasLimit) =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        contracts.staking.closeAllocation(allocationData.id, poi!, {
          gasLimit,
        }),
      logger,
    )

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationData.id}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = transactionManager.findEvent(
      'AllocationClosed',
      contracts.staking.interface,
      'allocationID',
      allocation,
      receipt,
      logger,
    )

    if (!closeAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Allocation close transaction was never successfully mined`,
      )
    }

    const rewardsEventLogs = transactionManager.findEvent(
      'RewardsAssigned',
      contracts.rewardsManager.interface,
      'allocationID',
      allocation,
      receipt,
      logger,
    )

    const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0

    if (rewardsAssigned == 0) {
      logger.warn('No rewards were distributed upon closing the allocation')
    }

    logger.info(`Successfully closed allocation`, {
      deployment: closeAllocationEventLogs.subgraphDeploymentID,
      allocation: closeAllocationEventLogs.allocationID,
      indexer: closeAllocationEventLogs.indexer,
      amountGRT: formatGRT(closeAllocationEventLogs.tokens),
      effectiveAllocation: closeAllocationEventLogs.effectiveAllocation.toString(),
      poi: closeAllocationEventLogs.poi,
      epoch: closeAllocationEventLogs.epoch.toString(),
      transaction: receipt.transactionHash,
      indexingRewards: rewardsAssigned,
    })

    logger.info('Identifying receipts worth collecting', {
      allocation: closeAllocationEventLogs.allocationID,
    })

    // Collect query fees for this allocation
    const isCollectingQueryFees = await receiptCollector.collectReceipts(
      0,
      allocationData,
    )

    logger.debug(
      `Updating indexing rules, so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
    )
    const offchainIndexingRule = {
      protocolNetwork: network.specification.networkIdentifier,
      identifier: allocationData.subgraphDeployment.id.ipfsHash,
      identifierType: IdentifierType.deployment,
      decisionBasis: IndexingDecisionBasis.offchain,
    }

    await models.IndexingRule.upsert(offchainIndexingRule)

    // Since upsert succeeded, we _must_ have a rule
    const updatedRule = await models.IndexingRule.findOne({
      where: { identifier: offchainIndexingRule.identifier },
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    logger.info(`DecisionBasis.OFFCHAIN rule merged into indexing rules`, {
      rule: updatedRule,
    })

    return {
      actionID: 0,
      type: 'unallocate',
      transactionID: receipt.transactionHash,
      allocation: closeAllocationEventLogs.allocationID,
      allocatedTokens: formatGRT(closeAllocationEventLogs.tokens),
      indexingRewards: formatGRT(rewardsAssigned),
      receiptsWorthCollecting: isCollectingQueryFees,
      protocolNetwork: network.specification.networkIdentifier,
    }
  } catch (error) {
    logger.error(error.toString())
    throw error
  }
}
