import {
  AllocationQueryBuilder,
  epochElapsedBlocks,
  Network,
} from '@graphprotocol/indexer-common'
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import { BigNumber, utils } from 'ethers'

import {
  Address,
  formatGRT,
  Logger,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  allocationIdProof,
  AllocationStatus,
  CloseAllocationResult,
  CreateAllocationResult,
  indexerError,
  IndexerErrorCode,
  IndexerManagementResolverContext,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  NetworkSubgraph,
  ReallocateAllocationResult,
  SubgraphIdentifierType,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import { extractNetwork } from './utils'

interface AllocationFilter {
  status: 'active' | 'closed'
  allocation: string | null
  subgraphDeployment: string | null
  protocolNetwork: string | null
}

/**
 * Flattens some of Allocation, and actually a response type. TODO: move to a separate file.s
 */
interface AllocationInfo {
  id: Address
  indexer: Address
  subgraphDeployment: string
  signalledTokens: string
  stakedTokens: string
  allocatedTokens: string
  createdAtEpoch: number
  closedAtEpoch: number | null
  ageInEpochs: number
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: string
  queryFeesCollected: string
  status: string
  protocolNetwork: string
}

async function queryAllocations(
  logger: Logger,
  networkSubgraph: NetworkSubgraph,
  variables: {
    indexer: Address | null
    allocation: Address | null
    status: 'active' | 'closed' | null
  },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationEpochs: number
    blocksPerEpoch: number
    avgBlockTime: number
    protocolNetwork: string
  },
): Promise<AllocationInfo[]> {
  logger.trace('Query Allocations', {
    variables,
    context,
  })

  const allocationsQuery = new AllocationQueryBuilder()
  if (variables.indexer) {
    allocationsQuery.setIndexer(variables.indexer)
  }
  if (variables.allocation) {
    allocationsQuery.setAllocation(variables.allocation)
  }
  if (variables.status) {
    allocationsQuery.setStatus(variables.status)
  }
  const resultAllocations = await networkSubgraph.allocationsQuery(
    allocationsQuery.build(),
  )

  if (resultAllocations.length == 0) {
    logger.info(`No 'Claimable' allocations found`)
    return []
  }

  return pMap(resultAllocations, async (allocation): Promise<AllocationInfo> => {
    const deadlineEpoch = allocation.createdAtEpoch + context.maxAllocationEpochs
    const remainingBlocks =
      context.blocksPerEpoch -
      context.currentEpochElapsedBlocks +
      context.blocksPerEpoch * (deadlineEpoch - context.currentEpoch - 1)
    return {
      id: allocation.id,
      indexer: allocation.indexer,
      subgraphDeployment: allocation.subgraphDeployment.id.ipfsHash,
      signalledTokens: allocation.subgraphDeployment.signalledTokens.toString(),
      stakedTokens: allocation.subgraphDeployment.stakedTokens.toString(),
      allocatedTokens: BigNumber.from(allocation.allocatedTokens).toString(),
      createdAtEpoch: allocation.createdAtEpoch,
      closedAtEpoch: allocation.closedAtEpoch,
      ageInEpochs: allocation.closedAtEpoch
        ? allocation.closedAtEpoch - allocation.createdAtEpoch
        : context.currentEpoch - allocation.createdAtEpoch,
      closeDeadlineEpoch: allocation.createdAtEpoch + context.maxAllocationEpochs,
      closeDeadlineBlocksRemaining: remainingBlocks,
      closeDeadlineTimeRemaining: remainingBlocks * context.avgBlockTime,
      indexingRewards: allocation.indexingRewards?.toString() ?? '0',
      queryFeesCollected: allocation.queryFeesCollected?.toString() ?? '0',
      status: allocation.status,
      protocolNetwork: context.protocolNetwork,
    }
  })
}

export default {
  allocations: async (
    { filter }: { filter: AllocationFilter },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<AllocationInfo[]> => {
    logger.debug('Execute allocations() query', {
      filter,
    })
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch allocations',
      )
    }

    const allocationsByNetwork = await multiNetworks.map(
      async (network: Network): Promise<AllocationInfo[]> => {
        // Return early if a different protocol network is specifically requested
        if (
          filter.protocolNetwork &&
          filter.protocolNetwork !== network.specification.networkIdentifier
        ) {
          return []
        }

        const {
          networkMonitor,
          networkSubgraph,
          contracts,
          specification: {
            indexerOptions: { address },
          },
        } = network

        const [currentEpoch, maxAllocationEpochs, epochLength] = await Promise.all([
          networkMonitor.networkCurrentEpoch(),
          contracts.staking.maxAllocationEpochs(),
          contracts.epochManager.epochLength(),
        ])

        const allocation = filter.allocation
          ? filter.allocation === 'all'
            ? null
            : toAddress(filter.allocation)
          : null

        const variables = {
          indexer: toAddress(address),
          allocation,
          status: filter.status,
        }

        const context = {
          currentEpoch: currentEpoch.epochNumber,
          currentEpochStartBlock: currentEpoch.startBlockNumber,
          currentEpochElapsedBlocks: epochElapsedBlocks(currentEpoch),
          latestBlock: currentEpoch.latestBlock,
          maxAllocationEpochs,
          blocksPerEpoch: epochLength.toNumber(),
          avgBlockTime: 13000,
          protocolNetwork: network.specification.networkIdentifier,
        }

        return queryAllocations(logger, networkSubgraph, variables, context)
      },
    )

    return Object.values(allocationsByNetwork).flat()
  },

  createAllocation: async (
    {
      deployment,
      amount,
      protocolNetwork,
    }: {
      deployment: string
      amount: string
      protocolNetwork: string
    },
    { multiNetworks, graphNode, logger, models }: IndexerManagementResolverContext,
  ): Promise<CreateAllocationResult> => {
    logger.debug('Execute createAllocation() mutation', {
      deployment,
      amount,
      protocolNetwork,
    })
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch allocations',
      )
    }
    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager
    const address = network.specification.indexerOptions.address

    const allocationAmount = parseGRT(amount)
    const subgraphDeployment = new SubgraphDeploymentID(deployment)

    const activeAllocations = await networkMonitor.allocations(AllocationStatus.ACTIVE)

    const allocation = activeAllocations.find(
      (allocation) =>
        allocation.subgraphDeployment.id.toString() === subgraphDeployment.toString(),
    )
    if (allocation) {
      logger.warn('Already allocated to deployment', {
        deployment: allocation.subgraphDeployment.id.ipfsHash,
        activeAllocation: allocation.id,
      })
      throw indexerError(
        IndexerErrorCode.IE060,
        `Allocation failed. An active allocation already exists for deployment '${allocation.subgraphDeployment.id.ipfsHash}'`,
      )
    }

    if (allocationAmount.lt('0')) {
      logger.warn('Cannot allocate a negative amount of GRT', {
        amount: formatGRT(allocationAmount),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount`,
      )
    }

    try {
      const currentEpoch = await contracts.epochManager.currentEpoch()

      // Identify how many GRT the indexer has staked
      const freeStake = await contracts.staking.getIndexerCapacity(address)

      // If there isn't enough left for allocating, abort
      if (freeStake.lt(allocationAmount)) {
        logger.error(
          `Allocation of ${formatGRT(
            allocationAmount,
          )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
            freeStake,
          )} GRT`,
        )
        throw indexerError(
          IndexerErrorCode.IE013,
          `Allocation of ${formatGRT(
            allocationAmount,
          )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
            freeStake,
          )} GRT`,
        )
      }

      // Ensure subgraph is deployed before allocating
      await graphNode.ensure(
        `indexer-agent/${subgraphDeployment.ipfsHash.slice(-10)}`,
        subgraphDeployment,
      )

      logger.debug('Obtain a unique Allocation ID')

      // Obtain a unique allocation ID
      const { allocationSigner, allocationId } = uniqueAllocationID(
        transactionManager.wallet.mnemonic.phrase,
        currentEpoch.toNumber(),
        subgraphDeployment,
        activeAllocations.map((allocation) => allocation.id),
      )

      // Double-check whether the allocationID already exists on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized }
      //
      // in the contracts.
      const state = await contracts.staking.getAllocationState(allocationId)
      if (state !== 0) {
        logger.debug(`Skipping allocation as it already exists onchain`, {
          indexer: address,
          allocation: allocationId,
          state,
        })
        throw indexerError(
          IndexerErrorCode.IE066,
          `Allocation '${allocationId}' already exists onchain`,
        )
      }

      logger.debug('Generating new allocation ID proof', {
        newAllocationSigner: allocationSigner,
        newAllocationID: allocationId,
        indexerAddress: address,
      })

      const proof = await allocationIdProof(allocationSigner, address, allocationId)

      logger.debug('Successfully generated allocation ID proof', {
        allocationIDProof: proof,
      })

      logger.debug(`Sending allocateFrom transaction`, {
        indexer: address,
        subgraphDeployment: subgraphDeployment.ipfsHash,
        amount: formatGRT(allocationAmount),
        allocation: allocationId,
        proof,
        protocolNetwork,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.staking.estimateGas.allocateFrom(
            address,
            subgraphDeployment.bytes32,
            allocationAmount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            proof,
          ),
        async (gasLimit) =>
          contracts.staking.allocateFrom(
            address,
            subgraphDeployment.bytes32,
            allocationAmount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            proof,
            { gasLimit },
          ),
        logger.child({ action: 'allocate' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw indexerError(
          IndexerErrorCode.IE062,
          `Allocation not created. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const createAllocationEventLogs = network.transactionManager.findEvent(
        'AllocationCreated',
        network.contracts.staking.interface,
        'subgraphDeploymentID',
        subgraphDeployment.toString(),
        receipt,
        logger,
      )

      if (!createAllocationEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE014,
          `Allocation create transaction was never mined`,
        )
      }

      logger.info(`Successfully allocated to subgraph deployment`, {
        amountGRT: formatGRT(createAllocationEventLogs.tokens),
        allocation: createAllocationEventLogs.allocationID,
        epoch: createAllocationEventLogs.epoch.toString(),
        transaction: receipt.transactionHash,
      })

      logger.debug(
        `Updating indexing rules, so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: subgraphDeployment.ipfsHash,
        allocationAmount: allocationAmount.toString(),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        protocolNetwork,
      } as Partial<IndexingRuleAttributes>

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
        type: 'allocate',
        transactionID: receipt.transactionHash,
        deployment,
        allocation: createAllocationEventLogs.allocationID,
        allocatedTokens: formatGRT(allocationAmount.toString()),
        protocolNetwork,
      }
    } catch (error) {
      logger.error(`Failed to allocate`, {
        amount: formatGRT(allocationAmount),
        error,
      })
      throw error
    }
  },

  closeAllocation: async (
    {
      allocation,
      poi,
      force,
      protocolNetwork,
    }: {
      allocation: string
      poi: string | undefined
      force: boolean
      protocolNetwork: string
    },
    { logger, models, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<CloseAllocationResult> => {
    logger.debug('Execute closeAllocation() mutation', {
      allocationID: allocation,
      poi: poi || 'none provided',
    })
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch allocations',
      )
    }
    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager
    const receiptCollector = network.receiptCollector

    const allocationData = await networkMonitor.allocation(allocation)

    try {
      poi = await networkMonitor.resolvePOI(allocationData, poi, force)

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
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      } as Partial<IndexingRuleAttributes>

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
  },

  reallocateAllocation: async (
    {
      allocation,
      poi,
      amount,
      force,
      protocolNetwork,
    }: {
      allocation: string
      poi: string | undefined
      amount: string
      force: boolean
      protocolNetwork: string
    },
    { logger, models, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<ReallocateAllocationResult> => {
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
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch allocations',
      )
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
      const currentEpoch = await contracts.epochManager.currentEpoch()

      logger.debug('Resolving POI')
      const allocationPOI = await networkMonitor.resolvePOI(allocationData, poi, force)
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
      const newAllocationState =
        await contracts.staking.getAllocationState(newAllocationId)
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
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        protocolNetwork,
      } as Partial<IndexingRuleAttributes>

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
  },

  submitCollectReceiptsJob: async (
    {
      allocation,
      protocolNetwork,
    }: {
      allocation: string
      protocolNetwork: string
    },
    { logger, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<boolean> => {
    logger.debug('Execute collectAllocationReceipts() mutation', {
      allocationID: allocation,
      protocolNetwork,
    })
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to collect receipts for an allocation',
      )
    }
    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const receiptCollector = network.receiptCollector

    const allocationData = await networkMonitor.allocation(allocation)

    try {
      logger.info('Identifying receipts worth collecting', {
        allocation: allocation,
      })

      // Collect query fees for this allocation
      const collecting = await receiptCollector.collectReceipts(0, allocationData)

      logger.info(`Submitted allocation receipt collection job for execution`, {
        allocationID: allocation,
        protocolNetwork: network.specification.networkIdentifier,
      })
      return collecting
    } catch (error) {
      logger.error(error.toString())
      throw error
    }
  },
}
