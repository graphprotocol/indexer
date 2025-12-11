/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { ethers, ZeroAddress } from 'ethers'

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
import { tryParseCustomError } from '../../utils'
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

async function createAllocation(
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

async function closeAllocation(
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

async function reallocateAllocation(
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

      const result = await createAllocation(
        network,
        graphNode,
        allocationAmount,
        logger,
        subgraphDeployment,
        currentEpoch,
        activeAllocations,
        protocolNetwork,
      )
      const txHash = result.txHash
      const allocationId = result.allocationId

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
      const parsedError = tryParseCustomError(error)
      logger.error(`Failed to allocate`, {
        amount: formatGRT(allocationAmount),
        error: parsedError,
      })
      throw parsedError
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

      const result = await closeAllocation(allocationData, poiData, network, logger)
      const txHash = result.txHash
      const rewardsAssigned = result.rewardsAssigned

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
      const parsedError = tryParseCustomError(error)
      logger.error('Failed to unallocate', { error: parsedError })
      throw parsedError
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

      const result = await reallocateAllocation(
        allocationData,
        allocationAmount,
        activeAllocations,
        poiData,
        network,
        logger,
      )
      const txHash = result.txHash
      const rewardsAssigned = result.rewardsAssigned
      const newAllocationId = result.newAllocationId

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
      const parsedError = tryParseCustomError(error)
      logger.error('Failed to reallocate', { error: parsedError })
      throw parsedError
    }
  },
}
