/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { TransactionReceipt, ZeroAddress } from 'ethers'

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
  encodeCollectData,
  epochElapsedBlocks,
  horizonAllocationIdProof,
  indexerError,
  IndexerErrorCode,
  IndexerManagementResolverContext,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  POIData,
  SubgraphClient,
  SubgraphIdentifierType,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import {
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
    maxAllocationDuration: number
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
      const deadlineEpoch = allocation.createdAtEpoch + context.maxAllocationDuration
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
  const freeStake = await network.networkMonitor.freeStake()

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

/**
 * Execute collect transaction for indexing rewards
 */
// RewardsManager reverts with this string `require` when the indexer is
// ineligible for rewards and `revertOnIneligible` is enabled on-chain.
const INDEXER_INELIGIBLE_REVERT = 'Indexer not eligible for rewards'

function isIndexerIneligibleRevert(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const { reason, shortMessage, message } = error as {
    reason?: unknown
    shortMessage?: unknown
    message?: unknown
  }
  return [reason, shortMessage, message].some(
    (field) => typeof field === 'string' && field.includes(INDEXER_INELIGIBLE_REVERT),
  )
}

async function executeCollectTransaction(
  network: Network,
  allocationId: string,
  collectData: string,
  logger: Logger,
): Promise<{ receipt: TransactionReceipt; rewardsCollected: bigint }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address

  let receipt: TransactionReceipt | 'paused' | 'unauthorized'
  try {
    receipt = await transactionManager.executeTransaction(
      async () =>
        contracts.SubgraphService.collect.estimateGas(
          address,
          PaymentTypes.IndexingRewards,
          collectData,
        ),
      async (gasLimit) =>
        contracts.SubgraphService.collect(
          address,
          PaymentTypes.IndexingRewards,
          collectData,
          { gasLimit },
        ),
      logger,
    )
  } catch (error) {
    if (isIndexerIneligibleRevert(error)) {
      throw indexerError(
        IndexerErrorCode.IE090,
        `Collect indexing rewards for allocation '${allocationId}' reverted: indexer not eligible for rewards`,
      )
    }
    throw error
  }

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Collect indexing rewards for allocation '${allocationId}' failed: ${receipt}`,
    )
  }

  const collectEventLogs = transactionManager.findEvent(
    'ServicePaymentCollected',
    contracts.SubgraphService.interface,
    'serviceProvider',
    address,
    receipt,
    logger,
  )

  if (!collectEventLogs) {
    throw indexerError(IndexerErrorCode.IE089, `Transaction was never successfully mined`)
  }

  const rewardsCollected = collectEventLogs.tokens ?? 0n

  return { receipt, rewardsCollected }
}

/**
 * Present POI and collect indexing rewards without closing the allocation (Horizon only)
 */
async function presentHorizonPOI(
  allocation: Allocation,
  poiData: POIData,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; rewardsCollected: bigint }> {
  const contracts = network.contracts
  const address = network.specification.indexerOptions.address

  // Double-check whether the allocation is still active on chain
  const allocationState = await contracts.SubgraphService.getAllocation(allocation.id)
  if (allocationState.closedAt !== 0n) {
    throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
  }

  const collectData = encodeCollectData(allocation.id, poiData)
  const { receipt, rewardsCollected } = await executeCollectTransaction(
    network,
    allocation.id,
    collectData,
    logger,
  )

  logger.info(`Successfully presented POI and collected indexing rewards`, {
    allocation: allocation.id,
    indexer: address,
    poi: poiData.poi,
    transaction: receipt.hash,
    indexingRewards: formatGRT(rewardsCollected),
  })

  return { txHash: receipt.hash, rewardsCollected }
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

  // Check if indexer is over-allocated - if so, collect() will auto-close the allocation
  // and we should NOT call stopService to avoid "AllocationClosed" revert
  const isOverAllocated = await contracts.SubgraphService.isOverAllocated(address)

  logger.debug('Checking over-allocation status for close allocation', {
    allocationId: allocation.id,
    isOverAllocated,
  })

  const collectData = encodeCollectData(allocation.id, poiData)

  let receipt: TransactionReceipt | 'paused' | 'unauthorized'
  let rewardsAssigned: bigint

  if (isOverAllocated) {
    // Reuse shared collect logic - allocation will auto-close
    logger.info(
      'Indexer is over-allocated, using collect-only transaction (allocation will auto-close)',
      { allocationId: allocation.id },
    )
    const result = await executeCollectTransaction(
      network,
      allocation.id,
      collectData,
      logger,
    )
    receipt = result.receipt
    rewardsAssigned = result.rewardsCollected
  } else {
    // Normal path: multicall collect + stopService
    const collectCallData = contracts.SubgraphService.interface.encodeFunctionData(
      'collect',
      [address, PaymentTypes.IndexingRewards, collectData],
    )
    const closeAllocationData = encodeStopServiceData(allocation.id)
    const stopServiceCallData = contracts.SubgraphService.interface.encodeFunctionData(
      'stopService',
      [address, closeAllocationData],
    )

    receipt = await transactionManager.executeTransaction(
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

    const collectEventLogs = transactionManager.findEvent(
      'ServicePaymentCollected',
      contracts.SubgraphService.interface,
      'serviceProvider',
      address,
      receipt,
      logger,
    )

    if (!collectEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Collecting indexing rewards for allocation '${allocation.id}' failed`,
      )
    }

    rewardsAssigned = collectEventLogs.tokens ?? 0n
  }

  if (rewardsAssigned === 0n) {
    logger.warn('No rewards were distributed upon closing the allocation')
  }

  const closeAllocationEventLogs = transactionManager.findEvent(
    'AllocationClosed',
    contracts.SubgraphService.interface,
    'allocationId',
    allocation.id,
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

      const { txHash, allocationId } = await createAllocation(
        network,
        graphNode,
        allocationAmount,
        logger,
        subgraphDeployment,
        currentEpoch,
        activeAllocations,
        protocolNetwork,
      )

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

      const { txHash, rewardsAssigned } = await closeAllocation(
        allocationData,
        poiData,
        network,
        logger,
      )

      logger.debug(
        `Updating indexing rules, so indexer-agent keeps the deployment synced but doesn't allocate to it`,
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

  presentPOI: async (
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
    { logger, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<{
    actionID: number
    type: string
    transactionID: string | undefined
    allocation: string
    indexingRewardsCollected: string
    protocolNetwork: string
  }> => {
    logger = logger.child({
      component: 'presentPOIResolver',
    })

    logger.info('Presenting POI (collecting indexing rewards without closing)', {
      allocation: allocation,
      poi: poi || 'none provided',
      force,
    })

    if (!multiNetworks) {
      throw Error('IndexerManagementClient must be in `network` mode to present POI')
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
        blockNumber === undefined ? undefined : Number(blockNumber),
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

      const result = await presentHorizonPOI(allocationData, poiData, network, logger)

      return {
        actionID: 0,
        type: 'presentPOI',
        transactionID: result.txHash,
        allocation: allocation,
        indexingRewardsCollected: formatGRT(result.rewardsCollected),
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      const parsedError = tryParseCustomError(error)
      logger.error('Failed to present POI', { error: parsedError })
      throw parsedError
    }
  },

  resizeAllocation: async (
    {
      allocation,
      amount,
      protocolNetwork,
    }: {
      allocation: string
      amount: string
      protocolNetwork: string
    },
    { logger, models, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<{
    actionID: number
    type: string
    transactionID: string | undefined
    allocation: string
    previousAmount: string
    newAmount: string
    protocolNetwork: string
  }> => {
    logger = logger.child({
      component: 'resizeAllocationResolver',
    })

    logger.info('Resizing allocation', {
      allocation,
      newAmount: amount,
    })

    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to resize allocation',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const allocationData = await networkMonitor.allocation(allocation)

    try {
      const newAmount = parseGRT(amount)
      const result = await resizeHorizonAllocation(
        allocationData,
        newAmount,
        network,
        logger,
      )

      logger.debug(
        `Updating indexing rules, so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: allocationData.subgraphDeployment.id.ipfsHash,
        allocationAmount: formatGRT(result.actualNewAmount),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        protocolNetwork,
      } as Partial<IndexingRuleAttributes>

      await models.IndexingRule.upsert(indexingRule)

      const updatedRule = await models.IndexingRule.findOne({
        where: { identifier: indexingRule.identifier },
      })
      logger.debug(`DecisionBasis.ALWAYS rule merged into indexing rules`, {
        rule: updatedRule,
      })

      return {
        actionID: 0,
        type: 'resize',
        transactionID: result.txHash,
        allocation: allocation,
        previousAmount: formatGRT(result.previousAmount),
        newAmount: formatGRT(result.actualNewAmount),
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      const parsedError = tryParseCustomError(error)
      logger.error('Failed to resize allocation', { error: parsedError })
      throw parsedError
    }
  },
}

// Helper function to execute a resize allocation transaction on Horizon.
async function resizeHorizonAllocation(
  allocation: Allocation,
  newAmount: bigint,
  network: Network,
  logger: Logger,
): Promise<{ txHash: string; previousAmount: bigint; actualNewAmount: bigint }> {
  const contracts = network.contracts
  const transactionManager = network.transactionManager

  // Validate the allocation is still active on chain
  const onChainAllocation = await contracts.SubgraphService.getAllocation(allocation.id)
  if (onChainAllocation.closedAt !== 0n) {
    throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
  }

  const previousAmount = onChainAllocation.tokens

  logger.debug('Executing resize allocation transaction', {
    allocationID: allocation.id,
    previousAmount: formatGRT(previousAmount),
    newAmount: formatGRT(newAmount),
  })

  const receipt = await transactionManager.executeTransaction(
    async () =>
      contracts.SubgraphService.resizeAllocation.estimateGas(
        allocation.indexer,
        allocation.id,
        newAmount,
      ),
    async (gasLimit) =>
      contracts.SubgraphService.resizeAllocation(
        allocation.indexer,
        allocation.id,
        newAmount,
        { gasLimit },
      ),
    logger,
  )

  if (receipt === 'paused' || receipt === 'unauthorized') {
    throw indexerError(
      IndexerErrorCode.IE062,
      `Resize allocation '${allocation.id}' failed: ${receipt}`,
    )
  }

  // Parse AllocationResized event to get actual values
  const resizeEventLogs = transactionManager.findEvent(
    'AllocationResized',
    contracts.SubgraphService.interface,
    'allocationId',
    allocation.id,
    receipt,
    logger,
  )

  if (!resizeEventLogs) {
    throw indexerError(
      IndexerErrorCode.IE015,
      'Resize allocation transaction was never successfully mined',
    )
  }

  const actualNewAmount = resizeEventLogs.newTokens ?? newAmount

  logger.info('Successfully resized allocation', {
    allocation: allocation.id,
    previousAmount: formatGRT(previousAmount),
    newAmount: formatGRT(actualNewAmount),
    transaction: receipt.hash,
  })

  return { txHash: receipt.hash, previousAmount, actualNewAmount }
}
