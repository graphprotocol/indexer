import { extractNetwork } from '../utils'
import {
  IdentifierType,
  IndexingDecisionBasis,
  type MutationResolvers,
} from './../../../types.generated'
import { formatGRT, parseGRT, toAddress } from '@graphprotocol/common-ts'
import { Allocation, AllocationStatus } from '../../../../allocations/types'
import { IndexerErrorCode, indexerError } from '../../../../errors'
import { BigNumber, utils } from 'ethers'
import { NetworkMonitor } from '../../../../indexer-management/monitor'
import { GraphNode } from '../../../../graph-node'
import { allocationIdProof, uniqueAllocationID } from '../../../../allocations/keys'

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

export const reallocateAllocation: NonNullable<
  MutationResolvers['reallocateAllocation']
> = async (
  _parent,
  { allocation, poi, amount, force, protocolNetwork },
  { logger, graphNode, models, multiNetworks },
) => {
  logger = logger.child({
    component: 'reallocateAllocationResolver',
  })

  logger.info('Reallocating allocation', {
    allocation: allocation,
    poi: poi || 'none provided',
    amount,
    force,
  })

  if (!multiNetworks) {
    throw Error('IndexerManagementClient must be in `network` mode to fetch allocations')
  }

  // Obtain the Network object and its associated components and data
  const network = extractNetwork(protocolNetwork, multiNetworks)
  const networkMonitor = network.networkMonitor
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const receiptCollector = network.receiptCollector
  const address = network.specification.indexerOptions.address

  const allocationAmount = parseGRT(amount)

  const activeAllocations = await networkMonitor.allocations(AllocationStatus.ACTIVE)

  const allocationAddress = toAddress(allocation)
  const allocationData = activeAllocations.find((allocation) => {
    return allocation.id === allocationAddress
  })

  if (!allocationData) {
    throw indexerError(
      IndexerErrorCode.IE063,
      `Reallocation failed: No active allocation with id '${allocation}' found`,
    )
  }

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

    logger.debug('Resolving POI')
    const allocationPOI = await resolvePOI(
      networkMonitor,
      graphNode,
      allocationData,
      poi || undefined,
      Boolean(force),
    )
    logger.debug('POI resolved', {
      userProvidedPOI: poi,
      poi: allocationPOI,
    })

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized }
    //
    // in the contracts.
    const state = await contracts.staking.getAllocationState(allocationData.id)
    if (state !== 1) {
      logger.warn(`Allocation has already been closed`)
      throw indexerError(IndexerErrorCode.IE065, `Allocation has already been closed`)
    }

    if (allocationAmount.lt('0')) {
      logger.warn('Cannot reallocate a negative amount of GRT', {
        amount: allocationAmount.toString(),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        'Cannot reallocate a negative amount of GRT',
      )
    }

    logger.info(`Reallocate to subgraph deployment`, {
      existingAllocationAmount: formatGRT(allocationData.allocatedTokens),
      newAllocationAmount: formatGRT(allocationAmount),
      epoch: currentEpoch.toString(),
    })

    // Identify how many GRT the indexer has staked
    const freeStake = await contracts.staking.getIndexerCapacity(address)

    // When reallocating, we will first close the old allocation and free up the GRT in that allocation
    // This GRT will be available in addition to freeStake for the new allocation
    const postCloseFreeStake = freeStake.add(allocationData.allocatedTokens)

    // If there isn't enough left for allocating, abort
    if (postCloseFreeStake.lt(allocationAmount)) {
      throw indexerError(
        IndexerErrorCode.IE013,
        `Unable to allocate ${formatGRT(
          allocationAmount,
        )} GRT: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT, plus ${formatGRT(
          allocationData.allocatedTokens,
        )} GRT from the existing allocation`,
      )
    }

    logger.debug('Generating a new unique Allocation ID')
    const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
      transactionManager.wallet.mnemonic.phrase,
      currentEpoch.toNumber(),
      allocationData.subgraphDeployment.id,
      activeAllocations.map((allocation) => allocation.id),
    )

    logger.debug('New unique Allocation ID generated', {
      newAllocationID: newAllocationId,
      newAllocationSigner: allocationSigner,
    })

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized }
    //
    // in the contracts.
    const newAllocationState = await contracts.staking.getAllocationState(newAllocationId)
    if (newAllocationState !== 0) {
      logger.warn(`Skipping Allocation as it already exists onchain`, {
        indexer: address,
        allocation: newAllocationId,
        newAllocationState,
      })
      throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
    }

    logger.debug('Generating new allocation ID proof', {
      newAllocationSigner: allocationSigner,
      newAllocationID: newAllocationId,
      indexerAddress: address,
    })
    const proof = await allocationIdProof(allocationSigner, address, newAllocationId)
    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    logger.info(`Sending close and allocate multicall transaction`, {
      indexer: address,
      amount: formatGRT(allocationAmount),
      oldAllocation: allocationData.id,
      newAllocation: newAllocationId,
      newAllocationAmount: formatGRT(allocationAmount),
      deployment: allocationData.subgraphDeployment.id.toString(),
      poi: allocationPOI,
      proof,
      epoch: currentEpoch.toString(),
    })

    const callData = [
      await contracts.staking.populateTransaction.closeAllocation(
        allocationData.id,
        allocationPOI,
      ),
      await contracts.staking.populateTransaction.allocateFrom(
        address,
        allocationData.subgraphDeployment.id.bytes32,
        allocationAmount,
        newAllocationId,
        utils.hexlify(Array(32).fill(0)), // metadata
        proof,
      ),
    ].map((tx) => tx.data as string)

    const receipt = await transactionManager.executeTransaction(
      async () => contracts.staking.estimateGas.multicall(callData),
      async (gasLimit) => contracts.staking.multicall(callData, { gasLimit }),
      logger.child({
        function: 'closeAndAllocate',
      }),
    )

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${newAllocationId}' could not be closed: ${receipt}`,
      )
    }

    const createAllocationEventLogs = transactionManager.findEvent(
      'AllocationCreated',
      contracts.staking.interface,
      'subgraphDeploymentID',
      allocationData.subgraphDeployment.id.toString(),
      receipt,
      logger,
    )

    if (!createAllocationEventLogs) {
      throw indexerError(IndexerErrorCode.IE014, `Allocation was never mined`)
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

    logger.info(`Successfully reallocated allocation`, {
      deployment: createAllocationEventLogs.subgraphDeploymentID,
      closedAllocation: closeAllocationEventLogs.allocationID,
      closedAllocationStakeGRT: formatGRT(closeAllocationEventLogs.tokens),
      closedAllocationPOI: closeAllocationEventLogs.poi,
      closedAllocationEpoch: closeAllocationEventLogs.epoch.toString(),
      indexingRewardsCollected: rewardsAssigned,
      createdAllocation: createAllocationEventLogs.allocationID,
      createdAllocationStakeGRT: formatGRT(createAllocationEventLogs.tokens),
      indexer: createAllocationEventLogs.indexer,
      epoch: createAllocationEventLogs.epoch.toString(),
      transaction: receipt.transactionHash,
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
      `Updating indexing rules, so indexer-agent will now manage the active allocation`,
    )
    const indexingRule = {
      identifier: allocationData.subgraphDeployment.id.ipfsHash,
      allocationAmount: allocationAmount.toString(),
      identifierType: IdentifierType.deployment,
      decisionBasis: IndexingDecisionBasis.always,
      protocolNetwork,
    }

    await models.IndexingRule.upsert(indexingRule)

    // Since upsert succeeded, we _must_ have a rule
    const updatedRule = await models.IndexingRule.findOne({
      where: { identifier: indexingRule.identifier },
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    logger.debug(`DecisionBasis.ALWAYS rule merged into indexing rules`, {
      rule: updatedRule,
    })

    return {
      actionID: 0,
      type: 'reallocate',
      transactionID: receipt.transactionHash,
      closedAllocation: closeAllocationEventLogs.allocationID,
      indexingRewardsCollected: formatGRT(rewardsAssigned),
      receiptsWorthCollecting: isCollectingQueryFees,
      createdAllocation: createAllocationEventLogs.allocationID,
      createdAllocationStake: formatGRT(createAllocationEventLogs.tokens),
      protocolNetwork,
    }
  } catch (error) {
    logger.error(error.toString())
    throw error
  }
}
