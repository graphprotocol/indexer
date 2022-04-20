/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { BigNumber, utils } from 'ethers'

import {
  Address,
  formatGRT,
  Logger,
  NetworkContracts,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  allocationIdProof,
  AllocationStatus,
  CreateAllocationResult,
  CloseAllocationResult,
  indexerError,
  IndexerErrorCode,
  IndexingDecisionBasis,
  IndexerManagementResolverContext,
  IndexingRuleAttributes,
  IndexingStatusResolver,
  NetworkSubgraph,
  parseGraphQLAllocation,
  ReallocateAllocationResult,
  SubgraphIdentifierType,
  TransactionManager,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'

interface AllocationFilter {
  status: 'active' | 'closed' | 'claimable'
  allocation: string | null
  subgraphDeployment: string | null
}

enum AllocationQuery {
  all = 'all',
  active = 'active',
  closed = 'closed',
  claimable = 'claimable',
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
}

const ALLOCATION_QUERIES = {
  [AllocationQuery.all]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer }, first: 1000) {
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
      }
    }
  `,
  [AllocationQuery.active]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer, status: Active }, first: 1000) {
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
      }
    }
  `,
  [AllocationQuery.claimable]: gql`
    query allocations($indexer: String!, $disputableEpoch: Int!) {
      allocations(
        where: { indexer: $indexer, closedAtEpoch_lte: $disputableEpoch, status: Closed }
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
      }
    }
  `,
  [AllocationQuery.closed]: gql`
    query allocations($indexer: String!) {
      allocations(where: { indexer: $indexer, status: Closed }, first: 1000) {
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
      }
    }
  `,
  [AllocationQuery.allocation]: gql`
    query allocations($allocation: String!) {
      allocations(where: { id: $allocation }, first: 1000) {
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
      }
    }
  `,
}

async function queryAllocations(
  logger: Logger,
  networkSubgraph: NetworkSubgraph,
  contracts: NetworkContracts,
  variables: {
    indexer: Address
    disputableEpoch: number
    allocation: Address | null
    status: 'active' | 'closed' | 'claimable' | null
  },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationEpochs: number
    blocksPerEpoch: number
    avgBlockTime: number
  },
): Promise<AllocationInfo[]> {
  logger.debug('Query Allocations', {
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
  } else if (variables.status == 'claimable') {
    filterType = AllocationQuery.claimable
    filterVars = {
      indexer: variables.indexer.toLowerCase(),
      disputableEpoch: variables.disputableEpoch,
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

  const result = await networkSubgraph.query(ALLOCATION_QUERIES[filterType], filterVars)

  if (result.data.allocations.length == 0) {
    logger.info(`No 'Claimable' allocations found`)
    return []
  }

  if (result.error) {
    logger.warning('Query failed', {
      error: result.error,
    })
    throw result.error
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pMap(
    result.data.allocations,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (allocation: any): Promise<AllocationInfo> => {
      const deadlineEpoch = allocation.createdAtEpoch + context.maxAllocationEpochs
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
        allocatedTokens: BigNumber.from(allocation.allocatedTokens).toString(),
        createdAtEpoch: allocation.createdAtEpoch,
        closedAtEpoch: allocation.closedAtEpoch,
        ageInEpochs: allocation.closedAtEpoch
          ? allocation.closedAtEpoch - allocation.createdAtEpoch
          : context.currentEpoch - allocation.createdAtEpoch,
        closeDeadlineEpoch: allocation.createdAtEpoch + context.maxAllocationEpochs,
        closeDeadlineBlocksRemaining: remainingBlocks,
        closeDeadlineTimeRemaining: remainingBlocks * context.avgBlockTime,
        indexingRewards: allocation.indexingRewards,
        queryFeesCollected: allocation.queryFeesCollected,
        status: allocation.status,
      }
    },
  )
}

async function resolvePOI(
  contracts: NetworkContracts,
  transactionManager: TransactionManager,
  indexingStatusResolver: IndexingStatusResolver,
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
            (await indexingStatusResolver.proofOfIndexing(
              allocation.subgraphDeployment.id,
              await transactionManager.ethereum.getBlock(
                (await contracts.epochManager.currentEpochBlock()).toNumber(),
              ),
              allocation.indexer,
            )) || utils.hexlify(Array(32).fill(0))
          )
      }
      break
    case false: {
      // Obtain the start block of the current epoch
      const epochStartBlockNumber = await contracts.epochManager.currentEpochBlock()
      const epochStartBlock = await transactionManager.ethereum.getBlock(
        epochStartBlockNumber.toNumber(),
      )
      const generatedPOI = await indexingStatusResolver.proofOfIndexing(
        allocation.subgraphDeployment.id,
        epochStartBlock,
        allocation.indexer,
      )
      switch (poi == generatedPOI) {
        case true:
          if (poi == undefined) {
            const deploymentStatus = await indexingStatusResolver.indexingStatus([
              allocation.subgraphDeployment.id,
            ])
            throw new Error(`POI not available for deployment at current epoch start block. ß
            currentEpochStartBlock: ${epochStartBlockNumber}
            deploymentStatus: ${
              deploymentStatus.length > 0
                ? JSON.stringify(deploymentStatus)
                : 'not deployed'
            }`)
          } else {
            return poi
          }
        case false:
          if (poi == undefined && generatedPOI !== undefined) {
            return generatedPOI
          } else if (poi !== undefined && generatedPOI == undefined) {
            return poi
          }
          throw new Error(`User provided POI does not match reference fetched from the graph-node. Use '--force' to bypass this POI accuracy check. 
            POI: ${poi}, 
            referencePOI: ${generatedPOI}`)
      }
    }
  }
}

export default {
  allocations: async (
    { filter }: { filter: AllocationFilter },
    { networkSubgraph, address, contracts, logger }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    logger.info('Fetch allocations', {
      filter,
    })

    const allocations: AllocationInfo[] = []

    const currentEpoch = await contracts.epochManager.currentEpoch()
    const disputeEpochs = await contracts.staking.channelDisputeEpochs()
    const variables = {
      indexer: toAddress(address),
      disputableEpoch: currentEpoch.sub(disputeEpochs).toNumber(),
      allocation: filter.allocation
        ? filter.allocation === 'all'
          ? null
          : toAddress(filter.allocation)
        : null,
      status: filter.status,
    }
    const context = {
      currentEpoch: currentEpoch.toNumber(),
      currentEpochStartBlock: (
        await contracts.epochManager.currentEpochBlock()
      ).toNumber(),
      currentEpochElapsedBlocks: (
        await contracts.epochManager.currentEpochBlockSinceStart()
      ).toNumber(),
      latestBlock: (await contracts.epochManager.blockNum()).toNumber(),
      maxAllocationEpochs: await contracts.staking.maxAllocationEpochs(),
      blocksPerEpoch: (await contracts.epochManager.epochLength()).toNumber(),
      avgBlockTime: 13_000,
    }

    allocations.push(
      ...(await queryAllocations(logger, networkSubgraph, contracts, variables, context)),
    )
    return allocations
  },

  createAllocation: async (
    {
      deployment,
      amount,
      indexNode,
    }: { deployment: string; amount: string; indexNode: string | undefined },
    {
      address,
      contracts,
      subgraphManager,
      logger,
      models,
      networkSubgraph,
      transactionManager,
    }: IndexerManagementResolverContext,
  ): Promise<CreateAllocationResult> => {
    logger.info('Creating allocation', { deployment, amount })

    const allocationAmount = parseGRT(amount)
    const subgraphDeployment = new SubgraphDeploymentID(deployment)
    let activeAllocations: Allocation[] = []

    // Fetch active allocations
    try {
      const result = await networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $status: AllocationStatus!) {
            allocations(where: { indexer: $indexer, status: $status }, first: 1000) {
              id
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              closedAtEpoch
              createdAtBlockHash
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
              }
            }
          }
        `,
        {
          indexer: address.toLocaleLowerCase(),
          status: AllocationStatus[AllocationStatus.Active],
        },
      )

      if (result.error) {
        throw result.error
      }

      if (result.data.allocations.length > 0) {
        activeAllocations = result.data.allocations.map(parseGraphQLAllocation)
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      logger.error(`Failed to query active indexer allocations`, {
        err,
      })
      throw err
    }

    const allocation = activeAllocations.find(
      (allocation) =>
        allocation.subgraphDeployment.id.toString() === subgraphDeployment.toString(),
    )
    if (allocation) {
      logger.warn('Already allocated to deployment', {
        deployment: allocation.subgraphDeployment.id.ipfsHash,
        activeAllocation: allocation.id,
      })
      throw new Error(
        `Allocation failed. An active allocation already exists for deployment '${allocation.subgraphDeployment.id.ipfsHash}'.`,
      )
    }

    if (allocationAmount.lt('0')) {
      logger.warn('Cannot allocate a negative amount of GRT', {
        amount: amount.toString(),
      })
      throw new Error(
        `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount.`,
      )
    }

    if (allocationAmount.eq('0')) {
      logger.warn('Cannot allocate zero GRT', {
        amount: allocationAmount.toString(),
      })
      throw new Error(
        `Invalid allocation amount provided (${allocationAmount.toString()}). Must use nonzero allocation amount.`,
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
          new Error(
            `Allocation of ${formatGRT(
              allocationAmount,
            )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
              freeStake,
            )} GRT`,
          ),
        )
      }

      // Ensure subgraph is deployed before allocating
      await subgraphManager.ensure(
        logger,
        models,
        `${subgraphDeployment.ipfsHash.slice(0, 23)}/${subgraphDeployment.ipfsHash.slice(
          23,
        )}`,
        subgraphDeployment,
        indexNode,
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
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await contracts.staking.getAllocationState(allocationId)
      if (state !== 0) {
        logger.debug(`Skipping allocation as it already exists onchain`, {
          indexer: address,
          allocation: allocationId,
          state,
        })
        throw new Error(`Allocation '${allocationId}' already exists onchain`)
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
        throw new Error(
          `Allocation not created. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const events = receipt.events || receipt.logs
      const event =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.staking.interface.getEventTopic('AllocationCreated'),
          ),
        )
      if (!event) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation was never mined`),
        )
      }

      const createEvent = contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        event.data,
        event.topics,
      )

      logger.info(`Successfully allocated to subgraph deployment`, {
        amountGRT: formatGRT(createEvent.tokens),
        allocation: createEvent.allocationID,
        epoch: createEvent.epoch.toString(),
      })

      logger.debug(
        `Updating indexing rules, so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: subgraphDeployment.ipfsHash,
        allocationAmount: allocationAmount.toString(),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
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
        deployment,
        allocation: createEvent.allocationID,
        allocatedTokens: formatGRT(allocationAmount.toString()),
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
    }: { allocation: string; poi: string | undefined; force: boolean },
    {
      contracts,
      indexingStatusResolver,
      logger,
      models,
      networkSubgraph,
      transactionManager,
      receiptCollector,
    }: IndexerManagementResolverContext,
  ): Promise<CloseAllocationResult> => {
    logger.info('Closing allocation', {
      allocationID: allocation,
      poi: poi || 'none provided',
    })

    const result = await networkSubgraph.query(
      gql`
        query allocation($allocation: String!) {
          allocation(id: $allocation) {
            id
            indexer {
              id
            }
            allocatedTokens
            createdAtEpoch
            createdAtBlockHash
            closedAtEpoch
            subgraphDeployment {
              id
              ipfsHash
              stakedTokens
              signalledTokens
            }
          }
        }
      `,
      { allocation: allocation.toLocaleLowerCase() },
    )
    if (result.error) {
      throw result.error
    }

    if (!result.data.allocation || result.data.length == 0) {
      throw new Error(
        `Allocation cannot be closed. No active allocation with id '${allocation}' found.`,
      )
    }
    const allocationData = parseGraphQLAllocation(result.data.allocation)

    try {
      // Ensure allocation is old enough to close
      const currentEpoch = await contracts.epochManager.currentEpoch()
      if (BigNumber.from(allocationData.createdAtEpoch).eq(currentEpoch)) {
        throw new Error(
          `Allocation '${
            allocationData.id
          }' cannot be closed until epoch ${currentEpoch.add(
            1,
          )}. (Allocations cannot be closed in the same epoch they were created).`,
        )
      }

      poi = await resolvePOI(
        contracts,
        transactionManager,
        indexingStatusResolver,
        allocationData,
        poi,
        force,
      )

      // Double-check whether the allocation is still active on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await contracts.staking.getAllocationState(allocationData.id)
      if (state !== 1) {
        throw new Error('Allocation has already been closed')
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
        throw new Error(
          `Allocation '${allocationData.id}' could not be closed: ${receipt}`,
        )
      }

      const events = receipt.events || receipt.logs

      const closeEvent =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.staking.interface.getEventTopic('AllocationClosed'),
          ),
        )
      if (!closeEvent) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation close transaction was never successfully mined`),
        )
      }
      const closeAllocationEventLogs = contracts.staking.interface.decodeEventLog(
        'AllocationClosed',
        closeEvent.data,
        closeEvent.topics,
      )

      const rewardsEvent =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.rewardsManager.interface.getEventTopic('RewardsAssigned'),
          ),
        )
      const rewardsAssigned = rewardsEvent
        ? contracts.rewardsManager.interface.decodeEventLog(
            'RewardsAssigned',
            rewardsEvent.data,
            rewardsEvent.topics,
          ).amount
        : 0

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
      const isCollectingQueryFees = await receiptCollector.collectReceipts(allocationData)

      logger.debug(
        `Updating indexing rules, so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
      )
      const offchainIndexingRule = {
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
        allocation: closeAllocationEventLogs.allocationID,
        allocatedTokens: formatGRT(closeAllocationEventLogs.tokens),
        indexingRewards: formatGRT(rewardsAssigned),
        receiptsWorthCollecting: isCollectingQueryFees,
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
    }: { allocation: string; poi: string | undefined; amount: string; force: boolean },
    {
      address,
      contracts,
      indexingStatusResolver,
      logger,
      models,
      networkSubgraph,
      transactionManager,
      receiptCollector,
    }: IndexerManagementResolverContext,
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

    const allocationAmount = parseGRT(amount)
    let activeAllocations: Allocation[] = []

    // Fetch active allocations
    try {
      const result = await networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $status: AllocationStatus!) {
            allocations(where: { indexer: $indexer, status: $status }, first: 1000) {
              id
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              closedAtEpoch
              createdAtBlockHash
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
              }
            }
          }
        `,
        {
          indexer: address.toLocaleLowerCase(),
          status: AllocationStatus[AllocationStatus.Active],
        },
      )

      if (result.error) {
        throw result.error
      }
      if (result.data.allocations.length > 0) {
        activeAllocations = result.data.allocations.map(parseGraphQLAllocation)
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      logger.error(`Failed to query active indexer allocations`, {
        err,
      })
      throw err
    }

    const allocationAddress = toAddress(allocation)
    const allocationData = activeAllocations.find((allocation) => {
      return allocation.id === allocationAddress
    })

    if (!allocationData) {
      logger.error(`No existing `)
      throw new Error(
        `Allocation cannot be refreshed. No active allocation with id '${allocation}' found.`,
      )
    }

    try {
      // Ensure allocation is old enough to close
      const currentEpoch = await contracts.epochManager.currentEpoch()
      if (BigNumber.from(allocationData.createdAtEpoch).eq(currentEpoch)) {
        throw new Error(
          `Allocation '${
            allocationData.id
          }' cannot be closed until epoch ${currentEpoch.add(
            1,
          )}. (Allocations cannot be closed in the same epoch they were created).`,
        )
      }

      logger.debug('Resolving POI')
      const allocationPOI = await resolvePOI(
        contracts,
        transactionManager,
        indexingStatusResolver,
        allocationData,
        poi,
        force,
      )
      logger.debug('POI resolved', {
        userProvidedPOI: poi,
        poi: allocationPOI,
      })

      // Double-check whether the allocation is still active on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await contracts.staking.getAllocationState(allocationData.id)
      if (state !== 1) {
        logger.warn(`Allocation has already been closed`)
        throw new Error(`Allocation has already been closed`)
      }

      if (allocationAmount.lt('0')) {
        logger.warn('Cannot reallocate a negative amount of GRT', {
          amount: allocationAmount.toString(),
        })
        throw new Error('Cannot reallocate a negative amount of GRT')
      }

      if (allocationAmount.eq('0')) {
        logger.warn('Cannot reallocate zero GRT, skipping this allocation', {
          amount: allocationAmount.toString(),
        })
        throw new Error(`Cannot reallocate zero GRT`)
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
          new Error(
            `Unable to allocate ${formatGRT(
              allocationAmount,
            )} GRT: indexer only has a free stake amount of ${formatGRT(
              freeStake,
            )} GRT, plus ${formatGRT(
              allocationData.allocatedTokens,
            )} GRT from the existing allocation`,
          ),
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
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const newAllocationState = await contracts.staking.getAllocationState(
        newAllocationId,
      )
      if (newAllocationState !== 0) {
        logger.warn(`Skipping Allocation as it already exists onchain`, {
          indexer: address,
          allocation: newAllocationId,
          newAllocationState,
        })
        throw new Error('AllocationID already exists')
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

      logger.info(`Sending closeAndAllocate transaction`, {
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

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.staking.estimateGas.closeAndAllocate(
            allocationData.id,
            allocationPOI,
            address,
            allocationData.subgraphDeployment.id.bytes32,
            allocationAmount,
            newAllocationId,
            utils.hexlify(Array(32).fill(0)), // metadata
            proof,
          ),
        async (gasLimit) =>
          contracts.staking.closeAndAllocate(
            allocationData.id,
            allocationPOI,
            address,
            allocationData.subgraphDeployment.id.bytes32,
            allocationAmount,
            newAllocationId,
            utils.hexlify(Array(32).fill(0)), // metadata
            proof,
            { gasLimit },
          ),
        logger.child({ action: 'closeAndAllocate' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw new Error(`Allocation '${newAllocationId}' could not be closed: ${receipt}`)
      }

      const events = receipt.events || receipt.logs
      const createEvent =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.staking.interface.getEventTopic('AllocationCreated'),
          ),
        )
      if (!createEvent) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation was never mined`),
        )
      }

      const createAllocationEventLogs = contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        createEvent.data,
        createEvent.topics,
      )

      const closeEvent =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.staking.interface.getEventTopic('AllocationClosed'),
          ),
        )
      if (!closeEvent) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation close transaction was never successfully mined`),
        )
      }
      const closeAllocationEventLogs = contracts.staking.interface.decodeEventLog(
        'AllocationClosed',
        closeEvent.data,
        closeEvent.topics,
      )

      const rewardsEvent =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.rewardsManager.interface.getEventTopic('RewardsAssigned'),
          ),
        )
      const rewardsAssigned = rewardsEvent
        ? contracts.rewardsManager.interface.decodeEventLog(
            'RewardsAssigned',
            rewardsEvent.data,
            rewardsEvent.topics,
          ).amount
        : 0

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
      const isCollectingQueryFees = await receiptCollector.collectReceipts(allocationData)

      logger.debug(
        `Updating indexing rules, so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: allocationData.subgraphDeployment.id.ipfsHash,
        allocationAmount: allocationAmount.toString(),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
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
        closedAllocation: closeAllocationEventLogs.allocationID,
        indexingRewardsCollected: formatGRT(rewardsAssigned),
        receiptsWorthCollecting: isCollectingQueryFees,
        createdAllocation: createAllocationEventLogs.allocationID,
        createdAllocationStake: formatGRT(createAllocationEventLogs.tokens),
      }
    } catch (error) {
      logger.error(error.toString())
      throw error
    }
  },
}
