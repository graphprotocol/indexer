import { extractNetwork } from '../../../../indexer-management/resolvers/utils'
import {
  IdentifierType,
  IndexingDecisionBasis,
  type MutationResolvers,
} from './../../../types.generated'
import { BigNumber, utils } from 'ethers'
import { IndexerErrorCode, indexerError } from '../../../../errors'
import { NetworkMonitor } from '../../../../indexer-management/monitor'
import { GraphNode } from '../../../../graph-node'
import { formatGRT } from '@graphprotocol/common-ts'
import { Allocation } from '../../../../allocations/types'

async function resolvePOI(
  networkMonitor: NetworkMonitor,
  graphNode: GraphNode,
  allocation: Allocation,
  poi: string | undefined,
  force: boolean,
): Promise<string> {
  // poi = undefined, force=true  -- submit even if poi is 0x0
  // poi = defined,   force=true  -- no generatedPOI needed, just submit the POI supplied (with some sanitation?)
  // poi = undefined, force=false -- submit with generated POI if one available
  // poi = defined,   force=false -- submit user defined POI only if generated POI matches
  switch (force) {
    case true:
      switch (!!poi) {
        case true:
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          return poi!
        case false:
          return (
            (await graphNode.proofOfIndexing(
              allocation.subgraphDeployment.id,
              await networkMonitor.fetchPOIBlockPointer(allocation),
              allocation.indexer,
            )) || utils.hexlify(Array(32).fill(0))
          )
      }
      break
    case false: {
      const currentEpochStartBlock = await networkMonitor.fetchPOIBlockPointer(allocation)
      const generatedPOI = await graphNode.proofOfIndexing(
        allocation.subgraphDeployment.id,
        currentEpochStartBlock,
        allocation.indexer,
      )
      switch (poi == generatedPOI) {
        case true:
          if (poi == undefined) {
            const deploymentStatus = await graphNode.indexingStatus([
              allocation.subgraphDeployment.id,
            ])
            throw indexerError(
              IndexerErrorCode.IE067,
              `POI not available for deployment at current epoch start block.
              currentEpochStartBlock: ${currentEpochStartBlock.number}
              deploymentStatus: ${
                deploymentStatus.length > 0
                  ? JSON.stringify(deploymentStatus)
                  : 'not deployed'
              }`,
            )
          } else {
            return poi
          }
        case false:
          if (poi == undefined && generatedPOI !== undefined) {
            return generatedPOI
          } else if (poi !== undefined && generatedPOI == undefined) {
            return poi
          }
          throw indexerError(
            IndexerErrorCode.IE068,
            `User provided POI does not match reference fetched from the graph-node. Use '--force' to bypass this POI accuracy check.
            POI: ${poi},
            referencePOI: ${generatedPOI}`,
          )
      }
    }
  }
}

export const closeAllocation: NonNullable<MutationResolvers['closeAllocation']> = async (
  _parent,
  { protocolNetwork, allocation, poi, force },
  { multiNetworks, logger, models, graphNode },
) => {
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
    // Ensure allocation is old enough to close
    const currentEpoch = await contracts.epochManager.currentEpoch()
    if (BigNumber.from(allocationData.createdAtEpoch).eq(currentEpoch)) {
      throw indexerError(
        IndexerErrorCode.IE064,
        `Allocation '${
          allocationData.id
        }' cannot be closed until epoch ${currentEpoch.add(
          1,
        )}. (Allocations cannot be closed in the same epoch they were created)`,
      )
    }

    poi = await resolvePOI(
      networkMonitor,
      graphNode,
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
