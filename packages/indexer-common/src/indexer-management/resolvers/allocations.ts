/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { ethers, hexlify, ZeroAddress } from 'ethers'

import {
  Address,
  formatGRT,
  Logger,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationStatus,
  CloseAllocationResult,
  CreateAllocationResult,
  epochElapsedBlocks,
  horizonAllocationIdProof,
  HorizonTransitionValue,
  indexerError,
  IndexerErrorCode,
  IndexerManagementResolverContext,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  legacyAllocationIdProof,
  Network,
  POIData,
  ReallocateAllocationResult,
  SubgraphClient,
  SubgraphIdentifierType,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import {
  encodeCollectIndexingRewardsData,
  encodePOIMetadata,
  encodeStartServiceData,
  encodeStopServiceData,
  PaymentTypes,
} from '@graphprotocol/toolshed'
import { extractNetwork } from './utils'
import { GraphNode } from '../../graph-node'

interface AllocationFilter {
  status: 'active' | 'closed'
  allocation: string | null
  subgraphDeployment: string | null
  protocolNetwork: string | null
}

enum AllocationQuery {
  all = 'all',
  active = 'active',
  closed = 'closed',
  allocation = 'allocation',
}

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
  isLegacy: boolean
}

const ALLOCATION_QUERIES = {
  [AllocationQuery.all]: gql`
    query allocations($indexer: String!, $lastId: String!) {
      allocations(
        where: { indexer: $indexer, id_gt: $lastId }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
        isLegacy
      }
    }
  `,
  [AllocationQuery.active]: gql`
    query allocations($indexer: String!, $lastId: String!) {
      allocations(
        where: { indexer: $indexer, id_gt: $lastId, status: Active }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
        isLegacy
      }
    }
  `,
  [AllocationQuery.closed]: gql`
    query allocations($indexer: String!, $lastId: String!) {
      allocations(
        where: { indexer: $indexer, id_gt: $lastId, status: Closed }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
        isLegacy
      }
    }
  `,
  [AllocationQuery.allocation]: gql`
    query allocations($allocation: String!, $lastId: String!) {
      allocations(
        where: { id: $allocation, id_gt: $lastId }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        subgraphDeployment {
          id
          stakedTokens
          signalledTokens
        }
        indexer {
          id
        }
        allocatedTokens
        createdAtEpoch
        closedAtEpoch
        indexingRewards
        queryFeesCollected
        status
        isLegacy
      }
    }
  `,
}

async function queryAllocations(
  logger: Logger,
  networkSubgraph: SubgraphClient,
  variables: {
    indexer: Address
    allocation: Address | null
    status: 'active' | 'closed' | null
  },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationDuration: HorizonTransitionValue
    blocksPerEpoch: number
    avgBlockTime: number
    protocolNetwork: string
  },
): Promise<AllocationInfo[]> {
  logger.trace('Query Allocations', {
    variables,
    context,
  })

  let filterType: AllocationQuery
  let filterVars: object
  if (variables.allocation) {
    filterType = AllocationQuery.allocation
    filterVars = {
      allocation: variables.allocation.toLowerCase(),
    }
  } else if (variables.status == null && variables.allocation == null) {
    filterType = AllocationQuery.all
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else if (variables.status == 'active') {
    filterType = AllocationQuery.active
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else if (variables.status == 'closed') {
    filterType = AllocationQuery.closed
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
    }
  } else {
    // Shouldn't ever get here
    throw new Error(
      `Unsupported combination of variables provided, variables: ${variables}`,
    )
  }

  let lastId = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultAllocations: any[] = []
  for (;;) {
    const pageVars = {
      ...filterVars,
      lastId,
    }
    const result = await networkSubgraph.checkedQuery(
      ALLOCATION_QUERIES[filterType],
      pageVars,
    )

    if (result.error) {
      logger.warning('Querying allocations failed', {
        error: result.error,
        lastId: lastId,
      })
      throw result.error
    }

    if (result.data.allocations.length == 0) {
      break
    }
    // merge results
    resultAllocations.push(...result.data.allocations)
    lastId = result.data.allocations.slice(-1)[0].id
  }

  if (resultAllocations.length == 0) {
    // TODO: Is 'Claimable' still the correct term here, after Exponential Rebates?
    logger.info(`No 'Claimable' allocations found`)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pMap(
    resultAllocations,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (allocation: any): Promise<AllocationInfo> => {
      const maxAllocationDuration = allocation.isLegacy
        ? context.maxAllocationDuration.legacy
        : context.maxAllocationDuration.horizon
      const deadlineEpoch = allocation.createdAtEpoch + maxAllocationDuration
      const remainingBlocks =
        // blocks remaining in current epoch
        context.blocksPerEpoch -
        context.currentEpochElapsedBlocks +
        // blocks in the remaining epochs after this one
        context.blocksPerEpoch * (deadlineEpoch - context.currentEpoch - 1)
      return {
        id: allocation.id,
        indexer: allocation.indexer.id,
        subgraphDeployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id)
          .ipfsHash,
        signalledTokens: allocation.subgraphDeployment.signalledTokens,
        stakedTokens: allocation.subgraphDeployment.stakedTokens,
        allocatedTokens: allocation.allocatedTokens.toString(),
        createdAtEpoch: allocation.createdAtEpoch,
        closedAtEpoch: allocation.closedAtEpoch,
        ageInEpochs: allocation.closedAtEpoch
          ? allocation.closedAtEpoch - allocation.createdAtEpoch
          : context.currentEpoch - allocation.createdAtEpoch,
        closeDeadlineEpoch: allocation.createdAtEpoch + context.maxAllocationDuration,
        closeDeadlineBlocksRemaining: remainingBlocks,
        closeDeadlineTimeRemaining: remainingBlocks * context.avgBlockTime,
        indexingRewards: allocation.indexingRewards,
        queryFeesCollected: allocation.queryFeesCollected,
        status: allocation.status,
        protocolNetwork: context.protocolNetwork,
        isLegacy: allocation.isLegacy,
      }
    },
  )
}

async function createLegacyAllocation(
  network: Network,
  graphNode: GraphNode,
  allocationAmount: bigint,
  logger: Logger,
  subgraphDeployment: SubgraphDeploymentID,
  currentEpoch: bigint,
  activeAllocations: Allocation[],
  protocolNetwork: string,
): Promise<{ txHash: string; allocationId: Address }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address

  // Identify how many GRT the indexer has staked
  const freeStake = await contracts.LegacyStaking.getIndexerCapacity(address)

  // If there isn't enough left for allocating, abort
  if (freeStake < allocationAmount) {
    logger.error(
      `Legacy allocation of ${formatGRT(
        allocationAmount,
      )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
        freeStake,
      )} GRT`,
    )
    throw indexerError(
      IndexerErrorCode.IE013,
      `Legacy allocation of ${formatGRT(
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

  logger.debug('Obtain a unique legacy Allocation ID')

  // Obtain a unique allocation ID
  const recentlyClosedAllocations =
    await network.networkMonitor.recentlyClosedAllocations(Number(currentEpoch), 2)
  const activeAndRecentlyClosedAllocations: Allocation[] = [
    ...recentlyClosedAllocations,
    ...activeAllocations,
  ]
  const { allocationSigner, allocationId } = uniqueAllocationID(
    transactionManager.wallet.mnemonic!.phrase,
    Number(currentEpoch),
    subgraphDeployment,
    activeAndRecentlyClosedAllocations.map((allocation) => allocation.id),
  )

  // Double-check whether the allocationID already exists on chain, to
  // avoid unnecessary transactions.
  // Note: We're checking the allocation state here, which is defined as
  //
  //     enum AllocationState { Null, Active, Closed, Finalized }
  //
  // in the contracts.
  const state = await contracts.LegacyStaking.getAllocationState(allocationId)
  if (state !== 0n) {
    logger.debug(`Skipping legacy allocation as it already exists onchain`, {
      indexer: address,
      allocation: allocationId,
    })
    throw indexerError(
      IndexerErrorCode.IE066,
      `Legacy allocation '${allocationId}' already exists onchain`,
    )
  }

  logger.debug('Generating new legacy allocation ID proof', {
    newAllocationSigner: allocationSigner,
    newAllocationID: allocationId,
    indexerAddress: address,
  })

  const proof = await legacyAllocationIdProof(allocationSigner, address, allocationId)

  logger.debug('Successfully generated legacy allocation ID proof', {
    allocationIDProof: proof,
  })

  logger.debug(`Sending legacy allocateFrom transaction`, {
    indexer: address,
    subgraphDeployment: subgraphDeployment.ipfsHash,
    amount: formatGRT(allocationAmount),
    allocation: allocationId,
    proof,
    protocolNetwork,
  })

  const receipt = await transactionManager.executeTransaction(
    async () =>
      contracts.LegacyStaking.allocateFrom.estimateGas(
        address,
        subgraphDeployment.bytes32,
        allocationAmount,
        allocationId,
        hexlify(new Uint8Array(32).fill(0)),
        proof,
      ),
    async (gasLimit) =>
      contracts.LegacyStaking.allocateFrom(
        address,
        subgraphDeployment.bytes32,
        allocationAmount,
        allocationId,
        hexlify(new Uint8Array(32).fill(0)),
        proof,
        { gasLimit },
      ),
    logger.child({ action: 'allocate' }),
  )

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Legacy allocation not created. ${
        receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
      }`,
    )
  }

  const createAllocationEventLogs = network.transactionManager.findEvent(
    'AllocationCreated',
    network.contracts.LegacyStaking.interface,
    'subgraphDeploymentID',
    subgraphDeployment.toString(),
    receipt,
    logger,
  )

  if (!createAllocationEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE014,
      `Legacy allocation create transaction was never mined`,
    )
  }

  logger.info(`Successfully legacy allocated to subgraph deployment`, {
    amountGRT: formatGRT(createAllocationEventLogs.tokens),
    allocation: createAllocationEventLogs.allocationID,
    epoch: createAllocationEventLogs.epoch.toString(),
    transaction: receipt.hash,
  })

  return { txHash: receipt.hash, allocationId: createAllocationEventLogs.allocationID }
}

async function createHorizonAllocation(
  network: Network,
  graphNode: GraphNode,
  allocationAmount: bigint,
  logger: Logger,
  subgraphDeployment: SubgraphDeploymentID,
  currentEpoch: bigint,
  activeAllocations: Allocation[],
  protocolNetwork: string,
): Promise<{ txHash: string; allocationId: Address }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address
  const dataService = contracts.SubgraphService.target.toString()

  // Identify how many GRT the indexer has staked
  const freeStake = (await network.networkMonitor.freeStake()).horizon

  // If there isn't enough left for allocating, abort
  if (freeStake < allocationAmount) {
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
  const recentlyClosedAllocations =
    await network.networkMonitor.recentlyClosedAllocations(Number(currentEpoch), 2)
  const activeAndRecentlyClosedAllocations: Allocation[] = [
    ...recentlyClosedAllocations,
    ...activeAllocations,
  ]
  const { allocationSigner, allocationId } = uniqueAllocationID(
    transactionManager.wallet.mnemonic!.phrase,
    Number(currentEpoch),
    subgraphDeployment,
    activeAndRecentlyClosedAllocations.map((allocation) => allocation.id),
  )

  // Double-check whether the allocationID already exists on chain, to
  // avoid unnecessary transactions.
  const allocation = await contracts.SubgraphService.getAllocation(allocationId)
  const legacyAllocation =
    await contracts.SubgraphService.getLegacyAllocation(allocationId)
  const existsSubgraphService = allocation.createdAt !== 0n
  const existsLegacyAllocation = legacyAllocation.indexer !== ZeroAddress
  if (existsSubgraphService || existsLegacyAllocation) {
    logger.debug(`Skipping allocation as it already exists onchain`, {
      indexer: address,
      allocation: allocationId,
      existsSubgraphService,
      existsLegacyAllocation,
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

  const chainId = Number(protocolNetwork.split(':')[1])
  const proof = await horizonAllocationIdProof(
    allocationSigner,
    chainId,
    address,
    allocationId,
    dataService,
  )

  logger.debug('Successfully generated allocation ID proof', {
    allocationIDProof: proof,
  })

  logger.debug(`Sending startService (allocate) transaction`, {
    indexer: address,
    subgraphDeployment: subgraphDeployment.ipfsHash,
    amount: formatGRT(allocationAmount),
    allocation: allocationId,
    proof,
    protocolNetwork,
  })

  const data = encodeStartServiceData(
    subgraphDeployment.bytes32,
    allocationAmount,
    allocationId,
    proof,
  )
  const receipt = await transactionManager.executeTransaction(
    async () => contracts.SubgraphService.startService.estimateGas(address, data),
    async (gasLimit) =>
      contracts.SubgraphService.startService(address, data, { gasLimit }),
    logger.child({ action: 'startService' }),
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
    'ServiceStarted',
    network.contracts.SubgraphService.interface,
    'data',
    data,
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
    amountGRT: formatGRT(allocationAmount),
    allocation: allocationId,
    epoch: currentEpoch.toString(),
    transaction: receipt.hash,
  })

  return { txHash: receipt.hash, allocationId }
}

async function closeLegacyAllocation(
  allocation: Allocation,
  poi: string,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; rewardsAssigned: bigint }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const isHorizon = await network.isHorizon.value()

  // Double-check whether the allocation is still active on chain, to
  // avoid unnecessary transactions.
  // Note: We're checking the allocation state here, which is defined as
  //
  //     enum AllocationState { Null, Active, Closed, Finalized }
  //
  // in the contracts.
  const state = await contracts.LegacyStaking.getAllocationState(allocation.id)
  if (state !== 1n) {
    throw indexerError(
      IndexerErrorCode.IE065,
      'Legacy allocation has already been closed',
    )
  }

  logger.debug('Sending legacy closeAllocation transaction')
  const receipt = await transactionManager.executeTransaction(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    () => contracts.LegacyStaking.closeAllocation.estimateGas(allocation.id, poi!),
    (gasLimit) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      contracts.LegacyStaking.closeAllocation(allocation.id, poi!, {
        gasLimit,
      }),
    logger,
  )

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Legacy allocation '${allocation.id}' could not be closed: ${receipt}`,
    )
  }

  const closeAllocationEventLogs = transactionManager.findEvent(
    'AllocationClosed',
    contracts.LegacyStaking.interface,
    'allocationID',
    allocation.id,
    receipt,
    logger,
  )

  if (!closeAllocationEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Legacy allocation close transaction was never successfully mined`,
    )
  }

  const rewardsEventLogs = transactionManager.findEvent(
    isHorizon ? 'HorizonRewardsAssigned' : 'RewardsAssigned',
    contracts.RewardsManager.interface,
    'allocationID',
    allocation.id,
    receipt,
    logger,
  )

  const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0
  if (rewardsAssigned == 0) {
    logger.warn('No rewards were distributed upon closing the legacy allocation')
  }

  logger.info(`Successfully closed legacy allocation`, {
    deployment: closeAllocationEventLogs.subgraphDeploymentID,
    allocation: closeAllocationEventLogs.allocationID,
    indexer: closeAllocationEventLogs.indexer,
    amountGRT: formatGRT(closeAllocationEventLogs.tokens),
    poi: closeAllocationEventLogs.poi,
    epoch: closeAllocationEventLogs.epoch.toString(),
    transaction: receipt.hash,
    indexingRewards: rewardsAssigned,
  })

  return { txHash: receipt.hash, rewardsAssigned }
}

async function closeHorizonAllocation(
  allocation: Allocation,
  poiData: POIData,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; rewardsAssigned: bigint }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address
  const currentEpoch = await contracts.EpochManager.currentEpoch()

  // Double-check whether the allocation is still active on chain, to
  // avoid unnecessary transactions.
  const allocationState = await contracts.SubgraphService.getAllocation(allocation.id)
  if (allocationState.closedAt !== 0n) {
    throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
  }

  const encodedPOIMetadata = encodePOIMetadata(
    poiData.blockNumber,
    poiData.publicPOI,
    poiData.indexingStatus,
    0,
    0,
  )
  const collectIndexingRewardsData = encodeCollectIndexingRewardsData(
    allocation.id,
    poiData.poi,
    encodedPOIMetadata,
  )

  const collectCallData = contracts.SubgraphService.interface.encodeFunctionData(
    'collect',
    [address, PaymentTypes.IndexingRewards, collectIndexingRewardsData],
  )
  const closeAllocationData = encodeStopServiceData(allocation.id)
  const stopServiceCallData = contracts.SubgraphService.interface.encodeFunctionData(
    'stopService',
    [address, closeAllocationData],
  )

  const receipt = await transactionManager.executeTransaction(
    async () =>
      contracts.SubgraphService.multicall.estimateGas([
        collectCallData,
        stopServiceCallData,
      ]),
    async (gasLimit) =>
      contracts.SubgraphService.multicall([collectCallData, stopServiceCallData], {
        gasLimit,
      }),
    logger,
  )

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Allocation '${allocation.id}' could not be closed: ${receipt}`,
    )
  }

  const collectIndexingRewardsEventLogs = transactionManager.findEvent(
    'ServicePaymentCollected',
    contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!collectIndexingRewardsEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Collecting indexing rewards for allocation '${allocation.id}' failed`,
    )
  }

  const rewardsAssigned = collectIndexingRewardsEventLogs
    ? collectIndexingRewardsEventLogs.tokens
    : 0n
  if (rewardsAssigned === 0n) {
    logger.warn('No rewards were distributed upon closing the allocation')
  }

  const closeAllocationEventLogs = transactionManager.findEvent(
    'ServiceStopped',
    contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!closeAllocationEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Allocation close transaction was never successfully mined`,
    )
  }

  const allocationStateAfter = await contracts.SubgraphService.getAllocation(
    allocation.id,
  )

  logger.info(`Successfully closed allocation`, {
    deployment: allocationStateAfter.subgraphDeploymentId,
    allocation: allocation.id,
    indexer: allocationStateAfter.indexer,
    amountGRT: formatGRT(allocationStateAfter.tokens),
    poi: poiData.poi,
    blockNumber: poiData.blockNumber,
    publicPOI: poiData.publicPOI,
    epoch: currentEpoch.toString(),
    transaction: receipt.hash,
    indexingRewards: rewardsAssigned,
  })

  logger.info('Identifying receipts worth collecting', {
    allocation: allocation.id,
  })

  return { txHash: receipt.hash, rewardsAssigned }
}

// isHorizon: false
async function reallocateLegacyAllocation(
  allocation: Allocation,
  allocationAmount: bigint,
  activeAllocations: Allocation[],
  poi: string,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; rewardsAssigned: bigint; newAllocationId: Address }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address
  const currentEpoch = await contracts.EpochManager.currentEpoch()
  const isHorizon = await network.isHorizon.value()

  // Double-check whether the allocation is still active on chain, to
  // avoid unnecessary transactions.
  // Note: We're checking the allocation state here, which is defined as
  //
  //     enum AllocationState { Null, Active, Closed, Finalized }
  //
  // in the contracts.
  const state = await contracts.LegacyStaking.getAllocationState(allocation.id)
  if (state !== 1n) {
    logger.warn(`Legacy allocation has already been closed`)
    throw indexerError(
      IndexerErrorCode.IE065,
      `Legacy allocation has already been closed`,
    )
  }

  if (allocationAmount < 0n) {
    logger.warn('Cannot legacy reallocate a negative amount of GRT', {
      amount: allocationAmount.toString(),
    })
    throw indexerError(
      IndexerErrorCode.IE061,
      'Cannot legacy reallocate a negative amount of GRT',
    )
  }

  logger.info(`Legacy reallocate to subgraph deployment`, {
    existingAllocationAmount: formatGRT(allocation.allocatedTokens),
    newAllocationAmount: formatGRT(allocationAmount),
    epoch: currentEpoch.toString(),
  })

  // Identify how many GRT the indexer has staked
  const freeStake = (await network.networkMonitor.freeStake()).legacy

  // When reallocating, we will first close the old allocation and free up the GRT in that allocation
  // This GRT will be available in addition to freeStake for the new allocation
  const postCloseFreeStake = freeStake + allocation.allocatedTokens

  // If there isn't enough left for allocating, abort
  if (postCloseFreeStake < allocationAmount) {
    throw indexerError(
      IndexerErrorCode.IE013,
      `Unable to legacy allocate ${formatGRT(
        allocationAmount,
      )} GRT: indexer only has a free stake amount of ${formatGRT(
        freeStake,
      )} GRT, plus ${formatGRT(
        allocation.allocatedTokens,
      )} GRT from the existing allocation`,
    )
  }

  logger.debug('Generating a new unique legacy Allocation ID')
  const recentlyClosedAllocations =
    await network.networkMonitor.recentlyClosedAllocations(Number(currentEpoch), 2)
  const activeAndRecentlyClosedAllocations: Allocation[] = [
    ...recentlyClosedAllocations,
    ...activeAllocations,
  ]
  const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
    transactionManager.wallet.mnemonic!.phrase,
    Number(currentEpoch),
    allocation.subgraphDeployment.id,
    activeAndRecentlyClosedAllocations.map((allocation) => allocation.id),
  )

  logger.debug('New unique legacy Allocation ID generated', {
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
    await contracts.LegacyStaking.getAllocationState(newAllocationId)
  if (newAllocationState !== 0n) {
    logger.warn(`Skipping legacy Allocation as it already exists onchain`, {
      indexer: address,
      allocation: newAllocationId,
      newAllocationState,
    })
    throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
  }

  logger.debug('Generating new legacy allocation ID proof', {
    newAllocationSigner: allocationSigner,
    newAllocationID: newAllocationId,
    indexerAddress: address,
  })
  const proof = await legacyAllocationIdProof(allocationSigner, address, newAllocationId)
  logger.debug('Successfully generated legacy allocation ID proof', {
    allocationIDProof: proof,
  })

  logger.info(`Sending legacy close and legacy allocate multicall transaction`, {
    indexer: address,
    amount: formatGRT(allocationAmount),
    oldAllocation: allocation.id,
    newAllocation: newAllocationId,
    newAllocationAmount: formatGRT(allocationAmount),
    deployment: allocation.subgraphDeployment.id.toString(),
    poi: poi,
    proof,
    epoch: currentEpoch.toString(),
  })

  const callData = [
    await contracts.LegacyStaking.closeAllocation.populateTransaction(allocation.id, poi),
    await contracts.LegacyStaking.allocateFrom.populateTransaction(
      address,
      allocation.subgraphDeployment.id.bytes32,
      allocationAmount,
      newAllocationId,
      hexlify(new Uint8Array(32).fill(0)), // metadata
      proof,
    ),
  ].map((tx) => tx.data as string)

  const receipt = await transactionManager.executeTransaction(
    async () => contracts.LegacyStaking.multicall.estimateGas(callData),
    async (gasLimit) => contracts.LegacyStaking.multicall(callData, { gasLimit }),
    logger.child({
      function: 'closeAndAllocate',
    }),
  )

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Legacy allocation '${newAllocationId}' could not be closed: ${receipt}`,
    )
  }

  const createAllocationEventLogs = transactionManager.findEvent(
    'AllocationCreated',
    contracts.LegacyStaking.interface,
    'subgraphDeploymentID',
    allocation.subgraphDeployment.id.toString(),
    receipt,
    logger,
  )

  if (!createAllocationEventLogs) {
    throw indexerError(IndexerErrorCode.IE014, `Legacy allocation was never mined`)
  }

  const closeAllocationEventLogs = transactionManager.findEvent(
    'AllocationClosed',
    contracts.LegacyStaking.interface,
    'allocationID',
    allocation.id,
    receipt,
    logger,
  )

  if (!closeAllocationEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Legacy allocation close transaction was never successfully mined`,
    )
  }

  const rewardsEventLogs = transactionManager.findEvent(
    isHorizon ? 'HorizonRewardsAssigned' : 'RewardsAssigned',
    contracts.RewardsManager.interface,
    'allocationID',
    allocation.id,
    receipt,
    logger,
  )

  const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0
  if (rewardsAssigned == 0) {
    logger.warn('No rewards were distributed upon closing the legacy allocation')
  }

  logger.info(`Successfully reallocated legacy allocation`, {
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
    transaction: receipt.hash,
  })

  logger.info('Identifying receipts worth collecting', {
    allocation: closeAllocationEventLogs.allocationID,
  })

  return { txHash: receipt.hash, rewardsAssigned, newAllocationId }
}

// isHorizon: true and allocation: not legacy
async function reallocateHorizonAllocation(
  allocation: Allocation,
  allocationAmount: bigint,
  activeAllocations: Allocation[],
  poiData: POIData,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; rewardsAssigned: bigint; newAllocationId: Address }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address
  const currentEpoch = await contracts.EpochManager.currentEpoch()
  const dataService = contracts.SubgraphService.target.toString()

  // Double-check whether the allocation is still active on chain, to
  // avoid unnecessary transactions.
  const allocationData = await contracts.SubgraphService.getAllocation(allocation.id)

  if (allocationData.closedAt !== 0n) {
    logger.warn(`Allocation has already been closed`)
    throw indexerError(IndexerErrorCode.IE065, `Allocation has already been closed`)
  }

  if (allocationAmount < 0n) {
    logger.warn('Cannot reallocate a negative amount of GRT', {
      amount: allocationAmount.toString(),
    })
    throw indexerError(
      IndexerErrorCode.IE061,
      'Cannot reallocate a negative amount of GRT',
    )
  }

  logger.info(`Reallocate to subgraph deployment`, {
    existingAllocationAmount: formatGRT(allocation.allocatedTokens),
    newAllocationAmount: formatGRT(allocationAmount),
    epoch: currentEpoch.toString(),
  })

  // Identify how many GRT the indexer has staked
  const freeStake = (await network.networkMonitor.freeStake()).horizon

  // When reallocating, we will first close the old allocation and free up the GRT in that allocation
  // This GRT will be available in addition to freeStake for the new allocation
  const postCloseFreeStake = freeStake + allocationData.tokens

  // If there isn't enough left for allocating, abort
  if (postCloseFreeStake < allocationAmount) {
    throw indexerError(
      IndexerErrorCode.IE013,
      `Unable to allocate ${formatGRT(
        allocationAmount,
      )} GRT: indexer only has a free stake amount of ${formatGRT(
        freeStake,
      )} GRT, plus ${formatGRT(
        allocation.allocatedTokens,
      )} GRT from the existing allocation`,
    )
  }

  logger.debug('Generating a new unique Allocation ID')
  const recentlyClosedAllocations =
    await network.networkMonitor.recentlyClosedAllocations(Number(currentEpoch), 2)
  const activeAndRecentlyClosedAllocations: Allocation[] = [
    ...recentlyClosedAllocations,
    ...activeAllocations,
  ]
  const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
    transactionManager.wallet.mnemonic!.phrase,
    Number(currentEpoch),
    allocation.subgraphDeployment.id,
    activeAndRecentlyClosedAllocations.map((allocation) => allocation.id),
  )

  logger.debug('New unique Allocation ID generated', {
    newAllocationID: newAllocationId,
    newAllocationSigner: allocationSigner,
  })

  // Double-check whether the allocationID already exists on chain, to
  // avoid unnecessary transactions.
  const newAllocationData = await contracts.SubgraphService.getAllocation(newAllocationId)
  if (newAllocationData.createdAt !== 0n) {
    logger.warn(`Skipping Allocation as it already exists onchain`, {
      indexer: address,
      allocation: newAllocationId,
      newAllocationData,
    })
    throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
  }

  logger.debug('Generating new allocation ID proof', {
    newAllocationSigner: allocationSigner,
    newAllocationID: newAllocationId,
    indexerAddress: address,
  })
  const chainId = Number(network.specification.networkIdentifier.split(':')[1])
  const proof = await horizonAllocationIdProof(
    allocationSigner,
    chainId,
    address,
    newAllocationId,
    dataService,
  )
  logger.debug('Successfully generated allocation ID proof', {
    allocationIDProof: proof,
  })

  logger.info(`Sending close and allocate multicall transaction`, {
    indexer: address,
    amount: formatGRT(allocationAmount),
    oldAllocation: allocation.id,
    newAllocation: newAllocationId,
    newAllocationAmount: formatGRT(allocationAmount),
    deployment: allocation.subgraphDeployment.id.toString(),
    poi: poiData.poi,
    proof,
    epoch: currentEpoch.toString(),
  })

  const encodedPOIMetadata = encodePOIMetadata(
    poiData.blockNumber,
    poiData.publicPOI,
    poiData.indexingStatus,
    0,
    0,
  )
  const collectIndexingRewardsData = encodeCollectIndexingRewardsData(
    allocation.id,
    poiData.poi,
    encodedPOIMetadata,
  )
  const closeAllocationData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address'],
    [allocation.id],
  )
  const createAllocationData = encodeStartServiceData(
    allocation.subgraphDeployment.id.bytes32,
    allocationAmount,
    newAllocationId,
    proof,
  )

  const collectCallData = contracts.SubgraphService.interface.encodeFunctionData(
    'collect',
    [address, PaymentTypes.IndexingRewards, collectIndexingRewardsData],
  )
  const stopServiceCallData = contracts.SubgraphService.interface.encodeFunctionData(
    'stopService',
    [address, closeAllocationData],
  )
  const startServiceCallData = contracts.SubgraphService.interface.encodeFunctionData(
    'startService',
    [address, createAllocationData],
  )

  const receipt = await transactionManager.executeTransaction(
    async () =>
      contracts.SubgraphService.multicall.estimateGas([
        collectCallData,
        stopServiceCallData,
        startServiceCallData,
      ]),
    async (gasLimit) =>
      contracts.SubgraphService.multicall(
        [collectCallData, stopServiceCallData, startServiceCallData],
        { gasLimit },
      ),
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

  logger.info('Finding create allocation event logs')
  const createAllocationEventLogs = network.transactionManager.findEvent(
    'ServiceStarted',
    network.contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!createAllocationEventLogs) {
    throw indexerError(IndexerErrorCode.IE014, `Allocation was never mined`)
  }

  logger.info('Finding collect indexing rewards event logs')
  const collectIndexingRewardsEventLogs = transactionManager.findEvent(
    'ServicePaymentCollected',
    contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!collectIndexingRewardsEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Collecting indexing rewards for allocation '${allocation.id}' failed`,
    )
  }

  const rewardsAssigned = collectIndexingRewardsEventLogs
    ? collectIndexingRewardsEventLogs.tokens
    : 0n
  if (rewardsAssigned === 0n) {
    logger.warn('No rewards were distributed upon closing the allocation')
  }

  logger.info('Finding close allocation event logs')
  const closeAllocationEventLogs = transactionManager.findEvent(
    'ServiceStopped',
    contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!closeAllocationEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      `Allocation close transaction was never successfully mined`,
    )
  }

  logger.info(`Successfully reallocated allocation`, {
    deployment: createAllocationEventLogs.subgraphDeploymentID,
    closedAllocation: allocation.id,
    closedAllocationStakeGRT: formatGRT(allocation.allocatedTokens),
    closedAllocationPOI: poiData.poi,
    closedAllocationEpoch: currentEpoch.toString(),
    indexingRewardsCollected: rewardsAssigned,
    createdAllocation: newAllocationId,
    createdAllocationStakeGRT: formatGRT(allocationAmount),
    indexer: address,
    epoch: currentEpoch.toString(),
    transaction: receipt.hash,
  })

  return { txHash: receipt.hash, rewardsAssigned, newAllocationId }
}

// isHorizon: true and allocation: legacy
async function migrateLegacyAllocationToHorizon(
  allocation: Allocation,
  allocationAmount: bigint,
  activeAllocations: Allocation[],
  poi: string,
  network: Network,
  graphNode: GraphNode,
  logger: Logger,
): Promise<{ txHash: string; rewardsAssigned: bigint; newAllocationId: Address }> {
  const contracts = network.contracts
  const currentEpoch = await contracts.EpochManager.currentEpoch()

  // We want to make sure that we close the legacy allocation even if reallocating to horizon would fail
  // so we don't use a multicall but send separate transactions for closing
  const closeAllocationResult = await closeLegacyAllocation(
    allocation,
    poi,
    network,
    logger,
  )

  // After closing the legacy allocation, we attempt to create a new horizon allocation
  const createAllocationResult = await createHorizonAllocation(
    network,
    graphNode,
    allocationAmount,
    logger,
    allocation.subgraphDeployment.id,
    currentEpoch,
    activeAllocations,
    network.specification.networkIdentifier,
  )

  return {
    txHash: createAllocationResult.txHash,
    rewardsAssigned: closeAllocationResult.rewardsAssigned,
    newAllocationId: createAllocationResult.allocationId,
  }
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

        const [currentEpoch, maxAllocationDuration, epochLength] = await Promise.all([
          networkMonitor.networkCurrentEpoch(),
          networkMonitor.maxAllocationDuration(),
          contracts.EpochManager.epochLength(),
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
          maxAllocationDuration: maxAllocationDuration,
          blocksPerEpoch: Number(epochLength),
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

    if (allocationAmount < 0n) {
      logger.warn('Cannot allocate a negative amount of GRT', {
        amount: formatGRT(allocationAmount),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount`,
      )
    }

    try {
      const currentEpoch = await network.contracts.EpochManager.currentEpoch()
      const isHorizon = await network.isHorizon.value()

      logger.debug('createAllocation: Checking allocation resolution path', {
        isHorizon,
      })

      let txHash: string
      let allocationId: Address
      if (isHorizon) {
        logger.debug('Creating horizon allocation')
        const result = await createHorizonAllocation(
          network,
          graphNode,
          allocationAmount,
          logger,
          subgraphDeployment,
          currentEpoch,
          activeAllocations,
          protocolNetwork,
        )
        txHash = result.txHash
        allocationId = result.allocationId
      } else {
        logger.debug('Creating legacy allocation')
        const result = await createLegacyAllocation(
          network,
          graphNode,
          allocationAmount,
          logger,
          subgraphDeployment,
          currentEpoch,
          activeAllocations,
          protocolNetwork,
        )
        txHash = result.txHash
        allocationId = result.allocationId
      }

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
        transactionID: txHash,
        deployment,
        allocation: allocationId,
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
      blockNumber,
      publicPOI,
      force,
      protocolNetwork,
    }: {
      allocation: string
      poi: string | undefined
      blockNumber: string | undefined
      publicPOI: string | undefined
      force: boolean
      protocolNetwork: string
    },
    { logger, models, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<CloseAllocationResult> => {
    logger.debug('Execute closeAllocation() mutation', {
      allocationID: allocation,
      poi: poi || 'none provided',
      blockNumber: blockNumber || 'none provided',
      publicPOI: publicPOI || 'none provided',
    })
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch allocations',
      )
    }
    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const allocationData = await networkMonitor.allocation(allocation)

    try {
      logger.debug('Resolving POI')
      const poiData = await networkMonitor.resolvePOI(
        allocationData,
        poi,
        allocationData.isLegacy ? undefined : publicPOI,
        allocationData.isLegacy || blockNumber === null ? undefined : Number(blockNumber),
        force,
      )
      logger.debug('POI resolved', {
        userProvidedPOI: poi,
        userProvidedPublicPOI: publicPOI,
        userProvidedBlockNumber: blockNumber,
        poi: poiData.poi,
        publicPOI: poiData.publicPOI,
        blockNumber: poiData.blockNumber,
        force,
      })

      logger.debug('closeAllocation: Checking allocation resolution path', {
        allocationIsLegacy: allocationData.isLegacy,
      })

      let txHash: string
      let rewardsAssigned: bigint
      if (allocationData.isLegacy) {
        logger.debug('Closing legacy allocation')
        const result = await closeLegacyAllocation(
          allocationData,
          poiData.poi,
          network,
          logger,
        )
        txHash = result.txHash
        rewardsAssigned = result.rewardsAssigned
      } else {
        logger.debug('Closing horizon allocation')
        const result = await closeHorizonAllocation(
          allocationData,
          poiData,
          network,
          logger,
        )
        txHash = result.txHash
        rewardsAssigned = result.rewardsAssigned
      }

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
        transactionID: txHash,
        allocation: allocation,
        allocatedTokens: formatGRT(allocationData.allocatedTokens),
        indexingRewards: formatGRT(rewardsAssigned),
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
      blockNumber,
      publicPOI,
      amount,
      force,
      protocolNetwork,
    }: {
      allocation: string
      poi: string | undefined
      blockNumber: string | undefined
      publicPOI: string | undefined
      amount: string
      force: boolean
      protocolNetwork: string
    },
    { logger, models, multiNetworks, graphNode }: IndexerManagementResolverContext,
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
      logger.debug('Resolving POI')
      const poiData = await networkMonitor.resolvePOI(
        allocationData,
        poi,
        publicPOI,
        blockNumber === null ? undefined : Number(blockNumber),
        force,
      )
      logger.debug('POI resolved', {
        userProvidedPOI: poi,
        userProvidedPublicPOI: publicPOI,
        userProvidedBlockNumber: blockNumber,
        poi: poiData.poi,
        publicPOI: poiData.publicPOI,
        blockNumber: poiData.blockNumber,
        force,
      })

      const isHorizon = await network.isHorizon.value()

      logger.debug('reallocateAllocation: Checking allocation resolution path', {
        isHorizon,
        allocationIsLegacy: allocationData.isLegacy,
      })

      let txHash: string
      let rewardsAssigned: bigint
      let newAllocationId: Address
      if (!isHorizon) {
        logger.debug('Reallocating legacy allocation')
        const result = await reallocateLegacyAllocation(
          allocationData,
          allocationAmount,
          activeAllocations,
          poiData.poi,
          network,
          logger,
        )
        txHash = result.txHash
        rewardsAssigned = result.rewardsAssigned
        newAllocationId = result.newAllocationId
      } else if (allocationData.isLegacy) {
        logger.debug('Migrating legacy allocation to horizon')
        const result = await migrateLegacyAllocationToHorizon(
          allocationData,
          allocationAmount,
          activeAllocations,
          poiData.poi,
          network,
          graphNode,
          logger,
        )
        txHash = result.txHash
        rewardsAssigned = result.rewardsAssigned
        newAllocationId = result.newAllocationId
      } else {
        logger.debug('Reallocating horizon allocation')
        const result = await reallocateHorizonAllocation(
          allocationData,
          allocationAmount,
          activeAllocations,
          poiData,
          network,
          logger,
        )
        txHash = result.txHash
        rewardsAssigned = result.rewardsAssigned
        newAllocationId = result.newAllocationId
      }

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
        transactionID: txHash,
        closedAllocation: allocation,
        indexingRewardsCollected: formatGRT(rewardsAssigned),
        createdAllocation: newAllocationId,
        createdAllocationStake: formatGRT(allocationAmount),
        protocolNetwork,
      }
    } catch (error) {
      logger.error(error.toString())
      throw error
    }
  },
}
