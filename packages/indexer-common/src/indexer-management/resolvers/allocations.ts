/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import pMap from 'p-map'
import gql from 'graphql-tag'
import { BigNumber, utils } from 'ethers'
import {
  Address,
  formatGRT,
  NetworkContracts,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  indexerError,
  IndexerErrorCode,
  IndexingDecisionBasis,
  IndexerManagementResolverContext,
  IndexingRuleAttributes,
  IndexingStatusResolver,
  NetworkSubgraph,
  parseGraphQLAllocation,
  SubgraphIdentifierType,
  TransactionManager,
  Allocation,
  AllocationStatus,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import { allocationIdProof } from '../../allocations/keys'

interface AllocationFilter {
  active: boolean
  claimable: boolean
  allocations: string[] | null
}

enum QueryAllocationMode {
  Active,
  Claimable,
}

export interface AllocationInfo {
  id: Address
  subgraphDeployment: string
  allocatedTokens: string
  createdAtEpoch: number
  closedAtEpoch: number | null
  ageInEpochs: number
  closeDeadlineEpoch: number
  closeDeadlineBlocksRemaining: number
  closeDeadlineTimeRemaining: number
  indexingRewards: string
  queryFeesCollected: string
  status: 'ACTIVE' | 'CLAIMABLE'
}

export interface CloseAllocationRequest {
  id: string
  poi: string | null
}

export interface CloseAllocationResult {
  id: string
  success: boolean
  indexerRewards: string
}

const ALLOCATION_QUERIES = {
  [QueryAllocationMode.Active]: {
    all: gql`
      query allocations($indexer: String!) {
        allocations(where: { indexer: $indexer, status: Active }, first: 1000) {
          id
          subgraphDeployment {
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
    allocations: gql`
      query allocations($indexer: String!, $allocations: [String!]!) {
        allocations(
          where: { indexer: $indexer, status: Active, id_in: $allocations }
          first: 1000
        ) {
          id
          subgraphDeployment {
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
  },

  [QueryAllocationMode.Claimable]: {
    all: gql`
      query allocations($indexer: String!, $disputableEpoch: Int!) {
        allocations(
          where: {
            indexer: $indexer
            closedAtEpoch_lte: $disputableEpoch
            status: Closed
          }
          first: 1000
        ) {
          id
          subgraphDeployment {
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
    allocations: gql`
      query allocations(
        $indexer: String!
        $disputableEpoch: Int!
        $allocations: [String!]!
      ) {
        allocations(
          where: {
            indexer: $indexer
            closedAtEpoch_lte: $disputableEpoch
            status: Closed
            id_in: $allocations
          }
          first: 1000
        ) {
          id
          subgraphDeployment {
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
  },
}

async function queryAllocations(
  networkSubgraph: NetworkSubgraph,
  contracts: NetworkContracts,
  mode: QueryAllocationMode,
  variables: { indexer: Address; disputableEpoch: number; allocations: Address[] | null },
  context: {
    currentEpoch: number
    currentEpochStartBlock: number
    currentEpochElapsedBlocks: number
    maxAllocationEpochs: number
    blocksPerEpoch: number
    avgBlockTime: number
  },
): Promise<AllocationInfo[]> {
  console.log('Fetching allocations')
  console.log('variables', variables)
  console.log('mode', mode)

  const result = await networkSubgraph.query(
    variables.allocations === null
      ? ALLOCATION_QUERIES[mode]['all']
      : ALLOCATION_QUERIES[mode]['allocations'],
    variables.allocations == null
      ? {
          indexer: variables.indexer.toLowerCase(),
          disputableEpoch: variables.disputableEpoch,
        }
      : {
          indexer: variables.indexer.toLowerCase(),
          disputableEpoch: variables.disputableEpoch,
          allocations: variables.allocations.map((allocation) =>
            allocation.toLowerCase(),
          ),
        },
  )

  if (result.error) {
    throw result.error
  }
  // console.log(result.data.allocations)
  console.log(result.data.allocations[0])
  console.log(result.data.allocations[0].subgraphDeployment.id)
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
        subgraphDeployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id)
          .ipfsHash,
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
        status: mode === QueryAllocationMode.Active ? 'ACTIVE' : 'CLAIMABLE',
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
            throw new Error(`POI not available for deployment at current epoch start block. 
            currentEpochStartBlock: ${epochStartBlockNumber}
            deploymentStatus: ${deploymentStatus}`)
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
    { networkSubgraph, address, contracts }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const allocations: AllocationInfo[] = []

    const currentEpoch = await contracts.epochManager.currentEpoch()
    const disputeEpochs = await contracts.staking.channelDisputeEpochs()
    const variables = {
      indexer: toAddress(address),
      disputableEpoch: currentEpoch.sub(disputeEpochs).toNumber(),
      allocations: filter.allocations
        ? filter.allocations.map((allocation) => toAddress(allocation))
        : null,
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

    if (filter.active) {
      allocations.push(
        ...(await queryAllocations(
          networkSubgraph,
          contracts,
          QueryAllocationMode.Active,
          variables,
          context,
        )),
      )
    }

    if (filter.claimable) {
      allocations.push(
        ...(await queryAllocations(
          networkSubgraph,
          contracts,
          QueryAllocationMode.Claimable,
          variables,
          context,
        )),
      )
    }
    console.log('allocations resolver result 1: ')
    console.log(allocations[0])
    return allocations
  },

  createAllocation: async (
    { deploymentID, amount }: { deploymentID: string; amount: string },
    {
      address,
      contracts,
      logger,
      models,
      networkSubgraph,
      transactionManager,
    }: IndexerManagementResolverContext,
  ): Promise<object> => {
    logger.info('Creating allocation', { deploymentID, amount })
    const allocationAmount = parseGRT(amount)
    const subgraphDeployment = new SubgraphDeploymentID(deploymentID)
    const activeAllocations: Allocation[] = []
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
      logger.info('Results', { result })
      if (result.data.allocations.length > 0) {
        activeAllocations.concat(result.data.allocations.map(parseGraphQLAllocation))
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      logger.error(`Failed to query active indexer allocations`, {
        err,
      })
      throw err
    }

    logger.info('activeAllos', {
      activeAllocations,
    })
    const allocation = activeAllocations.find(
      (allocation) => allocation.subgraphDeployment.id.value == deploymentID,
    )
    if (allocation) {
      logger.warn('Already allocated to deployment', {
        deployment: allocation.subgraphDeployment.id,
        activeAllocation: allocation.id,
      })
      return {
        deploymentID,
        amount: allocationAmount.toString(),
        success: false,
        failureReason: `An active allocation already exists for deployment '${allocation.subgraphDeployment.id.display}'.`,
      }
    }

    if (allocationAmount.lt('0')) {
      logger.warn('Cannot allocate a negative amount of GRT', {
        amount: amount.toString(),
      })
      return {
        deploymentID,
        amount: allocationAmount.toString(),
        success: false,
        failureReason: `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount.`,
      }
    }

    if (allocationAmount.eq('0')) {
      logger.warn('Cannot allocate zero GRT', {
        amount: allocationAmount.toString(),
      })
      return {
        deploymentID,
        amount: allocationAmount.toString(),
        success: false,
        failureReason: `Invalid allocation amount provided (${allocationAmount.toString()}). Must use nonzero allocation amount.`,
      }
    }

    try {
      const currentEpoch = await contracts.epochManager.currentEpoch()

      logger.info(`Allocate to subgraph deployment`, {
        amountGRT: formatGRT(allocationAmount),
        epoch: currentEpoch.toString(),
      })

      // Identify how many GRT the indexer has staked
      const freeStake = await contracts.staking.getIndexerCapacity(address)

      // If there isn't enough left for allocating, abort
      if (freeStake.lt(allocationAmount)) {
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
        return {
          deploymentID,
          amount: allocationAmount.toString(),
          success: false,
          failureReason: `Allocation '${allocationId}' already exists onchain`,
        }
      }

      logger.info(`Allocate`, {
        indexer: address,
        amount: formatGRT(allocationAmount),
        allocation: allocationId,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.staking.estimateGas.allocateFrom(
            address,
            subgraphDeployment.bytes32,
            allocationAmount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            await allocationIdProof(allocationSigner, address, allocationId),
          ),
        async (gasLimit) =>
          contracts.staking.allocateFrom(
            address,
            subgraphDeployment.bytes32,
            allocationAmount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            await allocationIdProof(allocationSigner, address, allocationId),
            { gasLimit },
          ),
        logger.child({ action: 'allocate' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        return {
          deploymentID,
          amount: allocationAmount.toString(),
          success: false,
          failureReason: `Allocation not created. ${
            receipt == 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        }
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

      const eventInputs = contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        event.data,
        event.topics,
      )

      logger.info(`Successfully allocated to subgraph deployment`, {
        amountGRT: formatGRT(eventInputs.tokens),
        allocation: eventInputs.allocationID,
        epoch: eventInputs.epoch.toString(),
      })

      logger.info(
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
      logger.info(`DecisionBasis.ALWAYS rule merged into indexing rules`, {
        rule: updatedRule,
      })

      return {
        deploymentID,
        amount: allocationAmount.toString(),
        success: true,
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
    { id, poi, force }: { id: string; poi: string | undefined; force: boolean },
    {
      address,
      contracts,
      indexingStatusResolver,
      logger,
      models,
      networkSubgraph,
      transactionManager,
    }: IndexerManagementResolverContext,
  ): Promise<object> => {
    logger.info('Closing allocation', { allocationID: id, poi })

    const result = await networkSubgraph.query(
      gql`
        query allocation($indexer: String!, $id: String!) {
          allocation(id: $id) {
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
              signalAmount
            }
          }
        }
      `,
      { id, indexer: address },
    )
    if (result.error) {
      throw result.error
    }
    if (result.data.length == 0) {
      throw new Error(
        `Allocation cannot be closed. No allocation with id '${id}' found onchain.`,
      )
    }
    const allocation = parseGraphQLAllocation(result.data.allocation)

    logger.info('zlog2', {
      allocation,
      deployment: allocation.subgraphDeployment.id.display,
    })

    try {
      // Ensure allocation is old enough to close
      const currentEpoch = await contracts.epochManager.currentEpoch()
      if (BigNumber.from(allocation.createdAtEpoch).eq(currentEpoch)) {
        throw new Error(
          `Allocation '${allocation.id}' cannot be closed until epoch ${currentEpoch.add(
            1,
          )}. (Allocations cannot be closed in the same epoch they were created).`,
        )
      }

      poi = await resolvePOI(
        contracts,
        transactionManager,
        indexingStatusResolver,
        allocation,
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
      const state = await contracts.staking.getAllocationState(allocation.id)
      if (state !== 1) {
        throw new Error('Allocation has already been closed')
      }

      logger.info('Submitting allocation close tx')
      const receipt = await transactionManager.executeTransaction(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        () => contracts.staking.estimateGas.closeAllocation(allocation.id, poi!),
        (gasLimit) =>
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          contracts.staking.closeAllocation(allocation.id, poi!, {
            gasLimit,
          }),
        logger,
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw new Error(`Allocation '${allocation.id}' could not be closed: ${receipt}`)
      }

      const events = receipt.events || receipt.logs
      const event =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            contracts.staking.interface.getEventTopic('AllocationClosed'),
          ),
        )
      if (!event) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation close transaction was never successfully mined`),
        )
      }

      const eventLogs = contracts.staking.interface.decodeEventLog(
        'AllocationClosed',
        event.data,
        event.topics,
      )

      logger.info(`Successfully closed allocation`, {
        deployment: eventLogs.subgraphDeploymentID,
        allocation: eventLogs.allocationID,
        indexer: eventLogs.indexer,
        amountGRT: formatGRT(eventLogs.tokens),
        effectiveAllocation: eventLogs.effectiveAllocation.toString(),
        poi: eventLogs.poi,
        epoch: eventLogs.epoch.toString(),
        transaction: receipt.transactionHash,
      })

      logger.info(
        `Updating indexing rules, so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
      )
      const offchainIndexingRule = {
        identifier: allocation.subgraphDeployment.id.ipfsHash,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      } as Partial<IndexingRuleAttributes>

      await models.IndexingRule.upsert(offchainIndexingRule)

      // Since upsert succeeded, we _must_ have a rule
      const updatedRule = await models.IndexingRule.findOne({
        where: { identifier: offchainIndexingRule.identifier },
      })
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      logger.info(`Offchain rule merged into indexing rules`, { rule: updatedRule })

      return {
        id: eventLogs.allocationID,
        indexerRewards: formatGRT(eventLogs.tokens),
        success: true,
      }
    } catch (error) {
      logger.error(error.toString())
      throw error
    }
  },

  refreshAllocation: async (
    {
      id,
      poi,
      amount,
      force,
    }: { id: string; poi: string | undefined; amount: string; force: boolean },
    {
      address,
      contracts,
      indexingStatusResolver,
      logger,
      models,
      networkSubgraph,
      transactionManager,
    }: IndexerManagementResolverContext,
  ): Promise<object> => {
    logger.info('Refresh allocation request received', {
      allocationID: id,
      poi,
      amount,
      force,
    })

    const allocationAmount = parseGRT(amount)
    const activeAllocations: Allocation[] = []
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
                signalAmount
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

      activeAllocations.concat(result.data.allocations.map(parseGraphQLAllocation))
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      logger.error(`Failed to query active indexer allocations`, {
        err,
      })
      throw err
    }

    logger.info('activeAllos', {
      activeAllocations,
    })
    const allocation = activeAllocations.find((allocation) => allocation.id == id)
    if (!allocation) {
      logger.error(`No existing `)
      throw new Error(
        `Allocation cannot be refreshed. No allocation with id '${id}' found onchain.`,
      )
    }

    logger.info('zlog2', {
      allocation,
      deployment: allocation.subgraphDeployment.id.display,
    })

    try {
      // Ensure allocation is old enough to close
      const currentEpoch = await contracts.epochManager.currentEpoch()
      if (BigNumber.from(allocation.createdAtEpoch).eq(currentEpoch)) {
        throw new Error(
          `Allocation '${allocation.id}' cannot be closed until epoch ${currentEpoch.add(
            1,
          )}. (Allocations cannot be closed in the same epoch they were created).`,
        )
      }

      const allocationPOI = await resolvePOI(
        contracts,
        transactionManager,
        indexingStatusResolver,
        allocation,
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
      const state = await contracts.staking.getAllocationState(allocation.id)
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
        existingAllocationAmount: formatGRT(allocation.allocatedTokens),
        newAllocationAmount: formatGRT(amount),
        epoch: currentEpoch.toString(),
      })

      // Identify how many GRT the indexer has staked
      const freeStake = await contracts.staking.getIndexerCapacity(address)

      // When reallocating, we will first close the old allocation and free up the GRT in that allocation
      // This GRT will be available in addition to freeStake for the new allocation
      const postCloseFreeStake = freeStake.add(allocation.allocatedTokens)

      // If there isn't enough left for allocating, abort
      if (postCloseFreeStake.lt(amount)) {
        throw indexerError(
          IndexerErrorCode.IE013,
          new Error(
            `Unable to allocate ${formatGRT(
              amount,
            )} GRT: indexer only has a free stake amount of ${formatGRT(
              freeStake,
            )} GRT, plus ${formatGRT(
              allocation.allocatedTokens,
            )} GRT from the existing allocation`,
          ),
        )
      }

      logger.debug('Obtain a unique Allocation ID')

      // Obtain a unique allocation ID
      const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
        transactionManager.wallet.mnemonic.phrase,
        currentEpoch.toNumber(),
        allocation.subgraphDeployment.id,
        activeAllocations.map((allocation) => allocation.id),
      )

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

      const proof = await allocationIdProof(allocationSigner, address, newAllocationId)

      logger.info(`Executing reallocate transaction`, {
        indexer: address,
        amount: formatGRT(amount),
        oldAllocation: allocation.id,
        newAllocation: newAllocationId,
        deployment: allocation.subgraphDeployment.id.toString(),
        poi: allocationPOI,
        proof,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.staking.estimateGas.closeAndAllocate(
            allocation.id,
            allocationPOI,
            address,
            allocation.subgraphDeployment.id.bytes32,
            amount,
            newAllocationId,
            utils.hexlify(Array(32).fill(0)), // metadata
            proof,
          ),
        async (gasLimit) =>
          contracts.staking.closeAndAllocate(
            allocation.id,
            allocationPOI,
            address,
            allocation.subgraphDeployment.id.bytes32,
            amount,
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

      const eventLogs = contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        event.data,
        event.topics,
      )

      logger.info(`Successfully refreshed allocation`, {
        deployment: eventLogs.subgraphDeploymentID,
        allocation: eventLogs.allocationID,
        indexer: eventLogs.indexer,
        amountGRT: formatGRT(eventLogs.tokens),
        effectiveAllocation: eventLogs.effectiveAllocation.toString(),
        poi: eventLogs.poi,
        epoch: eventLogs.epoch.toString(),
        transaction: receipt.transactionHash,
      })

      logger.info(
        `Updating indexing rules, so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
      )
      const offchainIndexingRule = {
        identifier: allocation.subgraphDeployment.id.ipfsHash,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      } as Partial<IndexingRuleAttributes>

      await models.IndexingRule.upsert(offchainIndexingRule)

      // Since upsert succeeded, we _must_ have a rule
      const updatedRule = await models.IndexingRule.findOne({
        where: { identifier: offchainIndexingRule.identifier },
      })
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      logger.info(`Offchain rule merged into indexing rules`, { rule: updatedRule })

      return {
        id: eventLogs.allocationID,
        indexerRewards: formatGRT(eventLogs.tokens),
        success: true,
      }
    } catch (error) {
      logger.error(error.toString())
      throw error
    }
  },
}
