import {
  formatGRT,
  Logger,
  NetworkContracts,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Action,
  ActionFailure,
  ActionType,
  allocationIdProof,
  AllocationResult,
  AllocationStatus,
  CloseAllocationResult,
  CreateAllocationResult,
  fetchIndexingRules,
  formatDeploymentName,
  indexerError,
  IndexerError,
  IndexerErrorCode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  isActionFailure,
  isDeploymentWorthAllocatingTowards,
  ReallocateAllocationResult,
  ReceiptCollector,
  SubgraphIdentifierType,
  TransactionManager,
  uniqueAllocationID,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'

import {
  BigNumber,
  BigNumberish,
  ContractReceipt,
  PopulatedTransaction,
  providers,
  utils,
} from 'ethers'
import { NetworkMonitor } from './monitor'
import { SubgraphManager } from './subgraphs'
import { BytesLike } from '@ethersproject/bytes'
import pMap from 'p-map'

export interface AllocateTransactionParams {
  indexer: string
  subgraphDeploymentID: BytesLike
  tokens: BigNumberish
  allocationID: string
  metadata: BytesLike
  proof: BytesLike
}

export interface UnallocateTransactionParams {
  allocationID: string
  poi: BytesLike
}

export interface ReallocateTransactionParams {
  closingAllocationID: string
  poi: BytesLike
  indexer: string
  subgraphDeploymentID: BytesLike
  tokens: BigNumberish
  newAllocationID: string
  metadata: BytesLike
  proof: BytesLike
}

// An Action with resolved Allocation and Unallocation values
export interface ResolvedAction {
  action: Action
  allocates: BigNumber
  unallocates: BigNumber
  rewards: BigNumber
  balance: BigNumber
}

export type PopulateTransactionResult = PopulatedTransaction | ActionFailure

export type TransactionResult =
  | ContractReceipt
  | 'paused'
  | 'unauthorized'
  | ActionFailure[]

export class AllocationManager {
  constructor(
    private contracts: NetworkContracts,
    private logger: Logger,
    private indexer: string,
    private models: IndexerManagementModels,
    private networkMonitor: NetworkMonitor,
    private receiptCollector: ReceiptCollector,
    private subgraphManager: SubgraphManager,
    private transactionManager: TransactionManager,
  ) {}

  async executeBatch(actions: Action[]): Promise<AllocationResult[]> {
    const result = await this.executeTransactions(actions)
    if (Array.isArray(result)) {
      return result as ActionFailure[]
    }
    return await this.confirmTransactions(result, actions)
  }

  async executeTransactions(actions: Action[]): Promise<TransactionResult> {
    if (actions.length < 1) {
      throw Error('Failed to populate batch transaction: no transactions supplied')
    }

    const validatedActions = await this.validateActionBatchFeasibilty(actions)
    const populateTransactionsResults = await this.prepareTransactions(validatedActions)

    const failedTransactionPreparations = populateTransactionsResults
      .filter((result) => isActionFailure(result))
      .map((result) => result as ActionFailure)

    if (failedTransactionPreparations.length > 0) {
      return failedTransactionPreparations
    }

    const callData = populateTransactionsResults
      .map((tx) => tx as PopulatedTransaction)
      .filter((tx: PopulatedTransaction) => !!tx.data)
      .map((tx) => tx.data as string)

    return await this.transactionManager.executeTransaction(
      async () => this.contracts.staking.estimateGas.multicall(callData),
      async (gasLimit) => this.contracts.staking.multicall(callData, { gasLimit }),
      this.logger.child({
        actions: `${JSON.stringify(validatedActions.map((action) => action.id))}`,
        function: 'staking.multicall',
      }),
    )
  }

  async confirmTransactions(
    receipt: ContractReceipt | 'paused' | 'unauthorized',
    actions: Action[],
  ): Promise<AllocationResult[]> {
    return pMap(
      actions,
      async (action) => {
        try {
          return await this.confirmActionExecution(receipt, action)
        } catch (error) {
          let transaction = undefined
          if (typeof receipt == 'object') {
            transaction = receipt.transactionHash ?? undefined
          }
          this.logger.error('Failed to confirm batch transaction', {
            error,
          })
          return {
            actionID: action.id,
            transactionID: transaction,
            failureReason:
              error instanceof IndexerError
                ? error.code
                : `Failed to confirm transactions: ${error.message}`,
          }
        }
      },
      { stopOnError: false },
    )
  }

  findEvent(
    eventType: string,
    contractInterface: utils.Interface,
    logKey: string,
    logValue: string,
    receipt: ContractReceipt,
  ): utils.Result | undefined {
    const events: Event[] | providers.Log[] = receipt.events || receipt.logs

    return events
      .filter((event) =>
        event.topics.includes(contractInterface.getEventTopic(eventType)),
      )
      .map((event) =>
        contractInterface.decodeEventLog(eventType, event.data, event.topics),
      )
      .find(
        (eventLogs: utils.Result) =>
          eventLogs[logKey].toLocaleLowerCase() === logValue.toLocaleLowerCase(),
      )
  }

  async confirmActionExecution(
    receipt: ContractReceipt | 'paused' | 'unauthorized',
    action: Action,
  ): Promise<AllocationResult> {
    switch (action.type) {
      case ActionType.ALLOCATE:
        return await this.confirmAllocate(
          action.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.deploymentID!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.amount!,
          receipt,
        )
      case ActionType.UNALLOCATE:
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return await this.confirmUnallocate(action.id, action.allocationID!, receipt)
      case ActionType.REALLOCATE:
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return await this.confirmReallocate(action.id, action.allocationID!, receipt)
    }
  }

  async prepareTransactions(actions: Action[]): Promise<PopulateTransactionResult[]> {
    return await pMap(actions, async (action) => await this.prepareTransaction(action), {
      stopOnError: false,
    })
  }
  async prepareTransaction(action: Action): Promise<PopulateTransactionResult> {
    const logger = this.logger.child({ action: action.id })
    logger.trace('Preparing transaction', {
      action,
    })
    try {
      switch (action.type) {
        case ActionType.ALLOCATE:
          return await this.prepareAllocate(
            logger,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            new SubgraphDeploymentID(action.deploymentID!),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            parseGRT(action.amount!),
            undefined,
          )
        case ActionType.UNALLOCATE:
          return await this.prepareUnallocate(
            logger,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            action.allocationID!,
            action.poi === null ? undefined : action.poi,
            action.force === null ? false : action.force,
          )
        case ActionType.REALLOCATE:
          return await this.prepareReallocate(
            logger,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            action.allocationID!,
            action.poi === null ? undefined : action.poi,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            parseGRT(action.amount!),
            action.force === null ? false : action.force,
          )
      }
    } catch (error) {
      logger.error(`Failed to prepare tx call data`, {
        error,
      })
      return {
        actionID: action.id,
        failureReason:
          error instanceof IndexerError
            ? error.code
            : `Failed to prepare tx call data: ${error.message}`,
      }
    }
  }

  async prepareAllocateParams(
    logger: Logger,
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    indexNode: string | undefined,
  ): Promise<AllocateTransactionParams> {
    logger.info('Preparing to allocate', {
      deployment: deployment.ipfsHash,
      amount: amount.toString(),
    })

    const activeAllocations = await this.networkMonitor.allocations(
      AllocationStatus.ACTIVE,
    )
    const allocation = activeAllocations.find(
      (allocation) =>
        allocation.subgraphDeployment.id.toString() === deployment.toString(),
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

    if (amount.lt('0')) {
      logger.warn('Cannot allocate a negative amount of GRT', {
        amount: amount.toString(),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount`,
      )
    }

    const currentEpoch = await this.contracts.epochManager.currentEpoch()

    // Identify how many GRT the indexer has staked
    const freeStake = await this.contracts.staking.getIndexerCapacity(this.indexer)

    // If there isn't enough left for allocating, abort
    if (freeStake.lt(amount)) {
      logger.error(
        `Allocation of ${formatGRT(
          amount,
        )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT`,
      )
      throw indexerError(
        IndexerErrorCode.IE013,
        `Allocation of ${formatGRT(
          amount,
        )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT`,
      )
    }

    const subgraphDeployment = await this.networkMonitor.requireSubgraphDeployment(
      deployment.ipfsHash,
    )

    // Ensure graft dependency is resolved
    await this.subgraphManager.resolveGrafting(
      logger,
      this.models,
      deployment,
      indexNode,
      0,
    )
    // Ensure subgraph is deployed before allocating
    await this.subgraphManager.ensure(
      logger,
      this.models,
      formatDeploymentName(subgraphDeployment),
      deployment,
      indexNode,
    )

    logger.debug('Obtain a unique Allocation ID')

    // Obtain a unique allocation ID
    const { allocationSigner, allocationId } = uniqueAllocationID(
      this.transactionManager.wallet.mnemonic.phrase,
      currentEpoch.toNumber(),
      deployment,
      activeAllocations.map((allocation) => allocation.id),
    )

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
    //
    // in the contracts.
    const state = await this.contracts.staking.getAllocationState(allocationId)
    if (state !== 0) {
      logger.debug(`Skipping allocation as it already exists onchain`, {
        indexer: this.indexer,
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
      indexerAddress: this.indexer,
    })

    const proof = await allocationIdProof(allocationSigner, this.indexer, allocationId)

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    return {
      indexer: this.indexer,
      subgraphDeploymentID: deployment.bytes32,
      tokens: amount,
      allocationID: allocationId,
      metadata: utils.hexlify(Array(32).fill(0)),
      proof,
    }
  }

  async confirmAllocate(
    actionID: number,
    deployment: string,
    amount: string,
    receipt: ContractReceipt | 'paused' | 'unauthorized',
  ): Promise<CreateAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    const subgraphDeployment = new SubgraphDeploymentID(deployment)
    logger.info(`Confirming 'allocateFrom' transaction`)
    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation not created. ${
          receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
        }`,
      )
    }

    const createAllocationEventLogs = this.findEvent(
      'AllocationCreated',
      this.contracts.staking.interface,
      'subgraphDeploymentID',
      subgraphDeployment.bytes32,
      receipt,
    )

    if (!createAllocationEventLogs) {
      throw indexerError(IndexerErrorCode.IE014, `Allocation was never mined`)
    }

    logger.info(`Successfully allocated to subgraph deployment`, {
      amountGRT: formatGRT(createAllocationEventLogs.tokens),
      allocation: createAllocationEventLogs.allocationID,
      deployment: createAllocationEventLogs.subgraphDeploymentID,
      epoch: createAllocationEventLogs.epoch.toString(),
    })

    // Remember allocation
    await this.receiptCollector.rememberAllocations(actionID, [
      createAllocationEventLogs.allocationID,
    ])

    const subgraphDeploymentID = new SubgraphDeploymentID(deployment)
    // If there is not yet an indexingRule that deems this deployment worth allocating to, make one
    if (!(await this.matchingRuleExists(logger, subgraphDeploymentID))) {
      logger.debug(
        `No matching indexing rule found; updating indexing rules so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: deployment,
        allocationAmount: amount,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
      } as Partial<IndexingRuleAttributes>

      await upsertIndexingRule(logger, this.models, indexingRule)
    }

    return {
      actionID,
      type: 'allocate',
      transactionID: receipt.transactionHash,
      deployment: deployment,
      allocation: createAllocationEventLogs.allocationID,
      allocatedTokens: amount,
    }
  }

  async prepareAllocate(
    logger: Logger,
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    indexNode: string | undefined,
  ): Promise<PopulatedTransaction> {
    const params = await this.prepareAllocateParams(logger, deployment, amount, indexNode)
    logger.debug(`Populating allocateFrom transaction`, {
      indexer: params.indexer,
      subgraphDeployment: params.subgraphDeploymentID,
      amount: formatGRT(params.tokens),
      allocation: params.allocationID,
      proof: params.proof,
    })
    return await this.contracts.staking.populateTransaction.allocateFrom(
      params.indexer,
      params.subgraphDeploymentID,
      params.tokens,
      params.allocationID,
      params.metadata,
      params.proof,
    )
  }

  async allocate(
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    indexNode: string | undefined,
  ): Promise<CreateAllocationResult> {
    try {
      const params = await this.prepareAllocateParams(
        this.logger,
        deployment,
        amount,
        indexNode,
      )

      this.logger.debug(`Sending allocateFrom transaction`, {
        indexer: params.indexer,
        subgraphDeployment: deployment.ipfsHash,
        amount: formatGRT(params.tokens),
        allocation: params.allocationID,
        proof: params.proof,
      })

      const receipt = await this.transactionManager.executeTransaction(
        async () =>
          this.contracts.staking.estimateGas.allocateFrom(
            params.indexer,
            params.subgraphDeploymentID,
            params.tokens,
            params.allocationID,
            params.metadata,
            params.proof,
          ),
        async (gasLimit) =>
          this.contracts.staking.allocateFrom(
            params.indexer,
            params.subgraphDeploymentID,
            params.tokens,
            params.allocationID,
            params.metadata,
            params.proof,
            { gasLimit },
          ),
        this.logger.child({ function: 'staking.allocate' }),
      )

      return await this.confirmAllocate(
        0,
        deployment.ipfsHash,
        amount.toString(),
        receipt,
      )
    } catch (error) {
      this.logger.error(`Failed to allocate`, {
        amount: formatGRT(amount),
        error,
      })
      throw error
    }
  }

  async prepareUnallocateParams(
    logger: Logger,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
  ): Promise<UnallocateTransactionParams> {
    logger.info('Preparing to close allocation (unallocate)', {
      allocationID: allocationID,
      poi: poi || 'none provided',
    })
    const allocation = await this.networkMonitor.allocation(allocationID)
    // Ensure allocation is old enough to close
    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    if (BigNumber.from(allocation.createdAtEpoch).eq(currentEpoch)) {
      throw indexerError(
        IndexerErrorCode.IE064,
        `Allocation '${allocation.id}' cannot be closed until epoch ${currentEpoch.add(
          1,
        )}. (Allocations cannot be closed in the same epoch they were created)`,
      )
    }

    poi = await this.networkMonitor.resolvePOI(allocation, poi, force)

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
    //
    // in the contracts.
    const state = await this.contracts.staking.getAllocationState(allocation.id)
    if (state !== 1) {
      throw indexerError(IndexerErrorCode.IE065)
    }

    return {
      allocationID: allocation.id,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      poi: poi!,
    }
  }

  async confirmUnallocate(
    actionID: number,
    allocationID: string,
    receipt: ContractReceipt | 'paused' | 'unauthorized',
  ): Promise<CloseAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    logger.info(`Confirming 'closeAllocation' transaction`)

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = this.findEvent(
      'AllocationClosed',
      this.contracts.staking.interface,
      'allocationID',
      allocationID,
      receipt,
    )

    if (!closeAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Allocation close transaction was never successfully mined`,
      )
    }

    const rewardsEventLogs = this.findEvent(
      'RewardsAssigned',
      this.contracts.rewardsManager.interface,
      'allocationID',
      allocationID,
      receipt,
    )

    const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0

    if (rewardsAssigned == 0) {
      logger.warn('No rewards were distributed upon closing the allocation')
    }

    const subgraphDeploymentID = new SubgraphDeploymentID(
      closeAllocationEventLogs.subgraphDeploymentID,
    )

    logger.info(`Successfully closed allocation`, {
      deployment: subgraphDeploymentID.display,
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
    const allocation = await this.networkMonitor.allocation(allocationID)
    // Collect query fees for this allocation
    const isCollectingQueryFees = await this.receiptCollector.collectReceipts(
      actionID,
      allocation,
    )

    // Upsert a rule so the agent keeps the deployment synced but doesn't allocate to it
    logger.debug(
      `Updating indexing rules so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
    )
    const offchainIndexingRule = {
      identifier: allocation.subgraphDeployment.id.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
    } as Partial<IndexingRuleAttributes>

    await upsertIndexingRule(logger, this.models, offchainIndexingRule)

    return {
      actionID,
      type: 'unallocate',
      transactionID: receipt.transactionHash,
      allocation: closeAllocationEventLogs.allocationID,
      allocatedTokens: formatGRT(closeAllocationEventLogs.tokens),
      indexingRewards: formatGRT(rewardsAssigned),
      receiptsWorthCollecting: isCollectingQueryFees,
    }
  }

  async populateUnallocateTransaction(
    logger: Logger,
    params: UnallocateTransactionParams,
  ): Promise<PopulatedTransaction> {
    logger.debug(`Populating closeAllocation transaction`, {
      allocationID: params.allocationID,
      POI: params.poi,
    })
    return await this.contracts.staking.populateTransaction.closeAllocation(
      params.allocationID,
      params.poi,
    )
  }

  async prepareUnallocate(
    logger: Logger,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
  ): Promise<PopulatedTransaction> {
    const params = await this.prepareUnallocateParams(logger, allocationID, poi, force)
    return await this.populateUnallocateTransaction(logger, params)
  }

  async unallocate(
    allocationID: string,
    poi: string | undefined,
    force: boolean,
  ): Promise<CloseAllocationResult> {
    try {
      const params = await this.prepareUnallocateParams(
        this.logger,
        allocationID,
        poi,
        force,
      )
      const allocation = await this.networkMonitor.allocation(allocationID)
      this.logger.debug('Sending closeAllocation transaction')
      const receipt = await this.transactionManager.executeTransaction(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        () =>
          this.contracts.staking.estimateGas.closeAllocation(
            params.allocationID,
            params.poi,
          ),
        (gasLimit) =>
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this.contracts.staking.closeAllocation(params.allocationID, params.poi, {
            gasLimit,
          }),
        this.logger.child({ function: 'staking.closeAllocation' }),
      )

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return await this.confirmUnallocate(0, allocation.id!, receipt)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE015, error)
      this.logger.warn(`Failed to close allocation`, {
        err,
      })
      throw err
    }
  }

  async prepareReallocateParams(
    logger: Logger,
    allocationID: string,
    poi: string | undefined,
    amount: BigNumber,
    force: boolean,
  ): Promise<ReallocateTransactionParams> {
    logger.info('Preparing to reallocate', {
      allocation: allocationID,
      poi: poi || 'none provided',
      amount: amount.toString(),
      force,
    })

    /* Fetch all active allocations and search for our input parameter `allocationID`.
     * We don't call `fetchAllocations` here because all allocations will be required
     * later when generating a new `uniqueAllocationID`. */
    const activeAllocations = await this.networkMonitor.allocations(
      AllocationStatus.ACTIVE,
    )
    const allocationAddress = toAddress(allocationID)
    const allocation = activeAllocations.find((allocation) => {
      return allocation.id === allocationAddress
    })
    if (!allocation) {
      logger.error(`No existing allocation`)
      throw indexerError(
        IndexerErrorCode.IE063,
        `Reallocation failed: No active allocation with id '${allocationID}' found`,
      )
    }

    // Ensure allocation is old enough to close
    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    if (BigNumber.from(allocation.createdAtEpoch).eq(currentEpoch)) {
      throw indexerError(
        IndexerErrorCode.IE064,
        `Allocation '${allocation.id}' cannot be closed until epoch ${currentEpoch.add(
          1,
        )}. (Allocations cannot be closed in the same epoch they were created)`,
      )
    }

    logger.debug('Resolving POI')
    const allocationPOI = await this.networkMonitor.resolvePOI(allocation, poi, force)
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
    // in the this.contracts.
    const state = await this.contracts.staking.getAllocationState(allocation.id)
    if (state !== 1) {
      logger.warn(`Allocation has already been closed`)
      throw indexerError(IndexerErrorCode.IE065, `Allocation has already been closed`)
    }

    if (amount.lt('0')) {
      logger.warn('Cannot reallocate a negative amount of GRT', {
        amount: amount.toString(),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        'Cannot reallocate a negative amount of GRT',
      )
    }

    // Identify how many GRT the indexer has staked
    const freeStake = await this.contracts.staking.getIndexerCapacity(this.indexer)

    // When reallocating, we will first close the old allocation and free up the GRT in that allocation
    // This GRT will be available in addition to freeStake for the new allocation
    const postCloseFreeStake = freeStake.add(allocation.allocatedTokens)

    // If there isn't enough left for allocating, abort
    if (postCloseFreeStake.lt(amount)) {
      throw indexerError(
        IndexerErrorCode.IE013,
        `Unable to allocate ${formatGRT(
          amount,
        )} GRT: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT, plus ${formatGRT(
          allocation.allocatedTokens,
        )} GRT from the existing allocation`,
      )
    }

    logger.debug('Generating a new unique Allocation ID')
    const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
      this.transactionManager.wallet.mnemonic.phrase,
      currentEpoch.toNumber(),
      allocation.subgraphDeployment.id,
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
    // in the this.contracts.
    const newAllocationState = await this.contracts.staking.getAllocationState(
      newAllocationId,
    )
    if (newAllocationState !== 0) {
      logger.warn(`Skipping Allocation as it already exists onchain`, {
        indexer: this.indexer,
        allocation: newAllocationId,
        newAllocationState,
      })
      throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
    }

    logger.debug('Generating new allocation ID proof', {
      newAllocationSigner: allocationSigner,
      newAllocationID: newAllocationId,
      indexerAddress: this.indexer,
    })
    const proof = await allocationIdProof(allocationSigner, this.indexer, newAllocationId)
    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    logger.info(`Prepared closeAndAllocate transaction`, {
      indexer: this.indexer,
      oldAllocationAmount: formatGRT(allocation.allocatedTokens),
      oldAllocation: allocation.id,
      newAllocation: newAllocationId,
      newAllocationAmount: formatGRT(amount),
      deployment: allocation.subgraphDeployment.id.toString(),
      poi: allocationPOI,
      proof,
      epoch: currentEpoch.toString(),
    })

    return {
      closingAllocationID: allocation.id,
      poi: allocationPOI,
      indexer: this.indexer,
      subgraphDeploymentID: allocation.subgraphDeployment.id.bytes32,
      tokens: amount,
      newAllocationID: newAllocationId,
      metadata: utils.hexlify(Array(32).fill(0)),
      proof,
    }
  }

  async confirmReallocate(
    actionID: number,
    allocationID: string,
    receipt: ContractReceipt | 'paused' | 'unauthorized',
  ): Promise<ReallocateAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    logger.info(`Confirming 'closeAndAllocate' transaction`, {
      allocationID,
    })
    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = this.findEvent(
      'AllocationClosed',
      this.contracts.staking.interface,
      'allocationID',
      allocationID,
      receipt,
    )

    if (!closeAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Allocation close transaction was never successfully mined`,
      )
    }

    const createAllocationEventLogs = this.findEvent(
      'AllocationCreated',
      this.contracts.staking.interface,
      'subgraphDeploymentID',
      closeAllocationEventLogs.subgraphDeploymentID,
      receipt,
    )

    if (!createAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE014,
        `Allocation create transaction was never mined`,
      )
    }

    const rewardsEventLogs = this.findEvent(
      'RewardsAssigned',
      this.contracts.rewardsManager.interface,
      'allocationID',
      allocationID,
      receipt,
    )

    const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0

    if (rewardsAssigned == 0) {
      logger.warn('No rewards were distributed upon closing the allocation')
    }

    const subgraphDeploymentID = new SubgraphDeploymentID(
      closeAllocationEventLogs.subgraphDeploymentID,
    )

    logger.info(`Successfully reallocated to deployment`, {
      deployment: subgraphDeploymentID.display,
      closedAllocation: closeAllocationEventLogs.allocationID,
      closedAllocationStakeGRT: formatGRT(closeAllocationEventLogs.tokens),
      closedAllocationPOI: closeAllocationEventLogs.poi,
      closedAllocationEpoch: closeAllocationEventLogs.epoch.toString(),
      indexingRewardsCollected: formatGRT(rewardsAssigned),
      createdAllocation: createAllocationEventLogs.allocationID,
      createdAllocationStakeGRT: formatGRT(createAllocationEventLogs.tokens),
      indexer: createAllocationEventLogs.indexer,
      epoch: createAllocationEventLogs.epoch.toString(),
      transaction: receipt.transactionHash,
    })

    logger.info('Identifying receipts worth collecting', {
      allocation: closeAllocationEventLogs.allocationID,
    })
    const allocation = await this.networkMonitor.allocation(allocationID)
    // Collect query fees for this allocation
    const isCollectingQueryFees = await this.receiptCollector.collectReceipts(
      actionID,
      allocation,
    )

    // If there is not yet an indexingRule that deems this deployment worth allocating to, make one
    if (!(await this.matchingRuleExists(logger, subgraphDeploymentID))) {
      logger.debug(
        `No matching indexing rule found; updating indexing rules so indexer-agent will manage the active allocation`,
      )
      const indexingRule = {
        identifier: allocation.subgraphDeployment.id.ipfsHash,
        allocationAmount: formatGRT(createAllocationEventLogs.tokens),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
      } as Partial<IndexingRuleAttributes>

      await upsertIndexingRule(logger, this.models, indexingRule)
    }

    return {
      actionID,
      type: 'reallocate',
      transactionID: receipt.transactionHash,
      closedAllocation: closeAllocationEventLogs.allocationID,
      indexingRewardsCollected: formatGRT(rewardsAssigned),
      receiptsWorthCollecting: isCollectingQueryFees,
      createdAllocation: createAllocationEventLogs.allocationID,
      createdAllocationStake: formatGRT(createAllocationEventLogs.tokens),
    }
  }

  async prepareReallocate(
    logger: Logger,
    allocationID: string,
    poi: string | undefined,
    amount: BigNumber,
    force: boolean,
  ): Promise<PopulatedTransaction> {
    const params = await this.prepareReallocateParams(
      logger,
      allocationID,
      poi,
      amount,
      force,
    )
    return await this.contracts.staking.populateTransaction.closeAndAllocate(
      params.closingAllocationID,
      params.poi,
      params.indexer,
      params.subgraphDeploymentID,
      params.tokens,
      params.newAllocationID,
      params.metadata,
      params.proof,
    )
  }

  async reallocate(
    allocationID: string,
    poi: string | undefined,
    amount: BigNumber,
    force: boolean,
  ): Promise<ReallocateAllocationResult> {
    try {
      const params = await this.prepareReallocateParams(
        this.logger,
        allocationID,
        poi,
        amount,
        force,
      )

      this.logger.info(`Sending closeAndAllocate transaction`, {
        indexer: params.indexer,
        oldAllocation: params.closingAllocationID,
        newAllocation: params.newAllocationID,
        newAllocationAmount: formatGRT(params.tokens),
        deployment: params.subgraphDeploymentID,
        poi: params.poi,
        proof: params.proof,
      })

      const receipt = await this.transactionManager.executeTransaction(
        async () =>
          this.contracts.staking.estimateGas.closeAndAllocate(
            params.closingAllocationID,
            params.poi,
            params.indexer,
            params.subgraphDeploymentID,
            params.tokens,
            params.newAllocationID,
            params.metadata,
            params.proof,
          ),
        async (gasLimit) =>
          this.contracts.staking.closeAndAllocate(
            params.closingAllocationID,
            params.poi,
            params.indexer,
            params.subgraphDeploymentID,
            params.tokens,
            params.newAllocationID,
            params.metadata,
            params.proof,
            { gasLimit },
          ),
        this.logger.child({ function: 'staking.closeAndAllocate' }),
      )

      return await this.confirmReallocate(0, allocationID, receipt)
    } catch (error) {
      this.logger.error(error.toString())
      throw error
    }
  }

  async matchingRuleExists(
    logger: Logger,
    subgraphDeploymentID: SubgraphDeploymentID,
  ): Promise<boolean> {
    const indexingRules = await fetchIndexingRules(this.models, true)
    const subgraphDeployment = await this.networkMonitor.subgraphDeployment(
      subgraphDeploymentID.ipfsHash,
    )
    if (!subgraphDeployment) {
      throw Error(
        `SHOULD BE UNREACHABLE: No matching subgraphDeployment (${subgraphDeploymentID.ipfsHash}) found on the network`,
      )
    }
    return isDeploymentWorthAllocatingTowards(logger, subgraphDeployment, indexingRules)
      .toAllocate
  }

  // Calculates the balance (GRT delta) of a single Action.
  async resolveActionDelta(action: Action): Promise<ResolvedAction> {
    let unallocates = BigNumber.from(0)
    let rewards = BigNumber.from(0)

    // Handle allocations
    let allocates
    if (action.amount) {
      allocates = parseGRT(action.amount)
    } else {
      allocates = BigNumber.from(0)
    }

    // Handle unallocations.
    // We intentionally don't check if the allocation is active now because it will be checked
    // later, when we prepare the transaction.

    if (action.type === ActionType.UNALLOCATE || action.type === ActionType.REALLOCATE) {
      // Ensure this Action have a valid allocationID
      if (action.allocationID === null || action.allocationID === undefined) {
        throw Error(
          `SHOULD BE UNREACHABLE: Unallocate or Reallocate action must have an allocationID field: ${action}`,
        )
      }

      // Fetch the allocation on chain to inspect its amount
      const allocation = await this.networkMonitor.allocation(action.allocationID)

      // Accrue rewards, except for null or zeroed POI
      const zeroHexString = utils.hexlify(Array(32).fill(0))
      rewards =
        !action.poi || action.poi === zeroHexString
          ? BigNumber.from(0)
          : await this.contracts.rewardsManager.getRewards(action.allocationID)

      unallocates = unallocates.add(allocation.allocatedTokens)
    }

    const balance = allocates.sub(unallocates).sub(rewards)
    return {
      action,
      allocates,
      unallocates,
      rewards,
      balance,
    }
  }

  async validateActionBatchFeasibilty(batch: Action[]): Promise<Action[]> {
    const logger = this.logger.child({ function: 'validateActionBatch' })
    logger.debug(`Validating action batch`, { size: batch.length })

    // Validate stake feasibility
    const freeStake = await this.contracts.staking.getIndexerCapacity(this.indexer)
    const mapper = async (action: Action) => this.resolveActionDelta(action)
    const resolvedBatch = await pMap(batch, mapper)
    const batchDelta: BigNumber = resolvedBatch
      .map((resolvedAction) => resolvedAction.balance)
      .reduce((a, b) => a.add(b))
    const newBalance = freeStake.sub(batchDelta)
    if (newBalance.isNegative()) {
      {
        throw indexerError(
          IndexerErrorCode.IE013,
          `Unfeasible action batch: Approved action batch GRT balance is ` +
            `${formatGRT(batchDelta)} ` +
            `but available stake equals ${formatGRT(freeStake)}.`,
        )
      }
    }

    /* Return actions sorted by GRT balance (ascending).
     * This ensures on-chain batch feasibility because higher unallocations are processed
     * first and larger allocations are processed last */
    return resolvedBatch
      .sort((a, b) => (a.balance.gt(b.balance) ? 1 : -1))
      .map((a) => a.action)
  }
}
