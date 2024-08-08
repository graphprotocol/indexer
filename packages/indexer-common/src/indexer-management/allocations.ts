import {
  formatGRT,
  Logger,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Action,
  ActionFailure,
  ActionType,
  Allocation,
  allocationIdProof,
  AllocationResult,
  AllocationStatus,
  CloseAllocationResult,
  CreateAllocationResult,
  fetchIndexingRules,
  GraphNode,
  indexerError,
  IndexerError,
  IndexerErrorCode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  IndexingStatus,
  isActionFailure,
  isDeploymentWorthAllocatingTowards,
  Network,
  ReallocateAllocationResult,
  SubgraphIdentifierType,
  SubgraphStatus,
  uniqueAllocationID,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'

import {
  BigNumber,
  BigNumberish,
  ContractReceipt,
  PopulatedTransaction,
  utils,
} from 'ethers'

import { BytesLike } from '@ethersproject/bytes'
import pMap from 'p-map'

export interface TransactionPreparationContext {
  activeAllocations: Allocation[]
  currentEpoch: BigNumber
  indexingStatuses: IndexingStatus[]
}

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
export interface ActionStakeUsageSummary {
  action: Action
  allocates: BigNumber
  unallocates: BigNumber
  rewards: BigNumber
  balance: BigNumber
}

export type PopulateTransactionResult =
  | PopulatedTransaction
  | PopulatedTransaction[]
  | ActionFailure

export type TransactionResult =
  | ContractReceipt
  | 'paused'
  | 'unauthorized'
  | ActionFailure[]

export class AllocationManager {
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private graphNode: GraphNode,
    private network: Network,
  ) {}

  async executeBatch(actions: Action[]): Promise<AllocationResult[]> {
    const logger = this.logger.child({ function: 'executeBatch' })
    logger.trace('Executing action batch', { actions })
    const result = await this.executeTransactions(actions)
    if (Array.isArray(result)) {
      logger.trace('Execute batch transaction failed', { actionBatchResult: result })
      return result as ActionFailure[]
    }
    return await this.confirmTransactions(result, actions)
  }

  async executeTransactions(actions: Action[]): Promise<TransactionResult> {
    const logger = this.logger.child({ function: 'executeTransactions' })
    logger.trace('Begin executing transactions', { actions })
    if (actions.length < 1) {
      throw Error('Failed to populate batch transaction: no transactions supplied')
    }

    const validatedActions = await this.validateActionBatchFeasibilty(actions)
    logger.trace('Validated actions', { validatedActions })

    await this.deployBeforeAllocating(logger, validatedActions)

    const populateTransactionsResults = await this.prepareTransactions(validatedActions)

    const failedTransactionPreparations = populateTransactionsResults
      .filter((result) => isActionFailure(result))
      .map((result) => result as ActionFailure)

    if (failedTransactionPreparations.length > 0) {
      logger.trace('Failed to prepare transactions', { failedTransactionPreparations })
      return failedTransactionPreparations
    }

    logger.trace('Prepared transactions ', {
      preparedTransactions: populateTransactionsResults,
    })

    const callData = populateTransactionsResults
      .flat()
      .map((tx) => tx as PopulatedTransaction)
      .filter((tx: PopulatedTransaction) => !!tx.data)
      .map((tx) => tx.data as string)
    logger.trace('Prepared transaction calldata', { callData })

    return await this.network.transactionManager.executeTransaction(
      async () => this.network.contracts.staking.estimateGas.multicall(callData),
      async (gasLimit) =>
        this.network.contracts.staking.multicall(callData, { gasLimit }),
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
    const logger = this.logger.child({
      function: 'confirmTransactions',
      receipt,
      actions,
    })
    logger.trace('Confirming transaction')
    return pMap(
      actions,
      async (action: Action) => {
        try {
          return await this.confirmActionExecution(receipt, action)
        } catch (error) {
          let transaction: string | undefined = undefined
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
            protocolNetwork: action.protocolNetwork,
          }
        }
      },
      { stopOnError: false },
    )
  }

  async confirmActionExecution(
    receipt: ContractReceipt | 'paused' | 'unauthorized',
    action: Action,
  ): Promise<AllocationResult> {
    // Ensure we are handling an action for the same configured network
    if (action.protocolNetwork !== this.network.specification.networkIdentifier) {
      const errorMessage = `AllocationManager is configured for '${this.network.specification.networkIdentifier}' but got an Action targeting '${action.protocolNetwork}' `
      this.logger.crit(errorMessage, {
        action,
      })
      throw new Error(errorMessage)
    }

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
        return await this.confirmUnallocate(
          action.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.allocationID!,
          receipt,
        )
      case ActionType.REALLOCATE:
        return await this.confirmReallocate(
          action.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.allocationID!,
          receipt,
        )
    }
  }

  async prepareTransactions(actions: Action[]): Promise<PopulateTransactionResult[]> {
    const context: TransactionPreparationContext = {
      activeAllocations: await this.network.networkMonitor.allocations(
        AllocationStatus.ACTIVE,
      ),
      currentEpoch: await this.network.contracts.epochManager.currentEpoch(),
      indexingStatuses: await this.graphNode.indexingStatus([]),
    }
    return await pMap(
      actions,
      async (action: Action) => await this.prepareTransaction(action, context),
      {
        stopOnError: false,
      },
    )
  }

  async prepareTransaction(
    action: Action,
    context: TransactionPreparationContext,
  ): Promise<PopulateTransactionResult> {
    const logger = this.logger.child({ action: action.id })
    logger.trace('Preparing transaction', {
      action,
    })
    try {
      switch (action.type) {
        case ActionType.ALLOCATE:
          return await this.prepareAllocate(
            logger,
            context,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            new SubgraphDeploymentID(action.deploymentID!),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            parseGRT(action.amount!),
          )
        case ActionType.UNALLOCATE:
          return await this.prepareUnallocate(
            logger,
            context,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            action.allocationID!,
            action.poi === null ? undefined : action.poi,
            action.force === null ? false : action.force,
          )
        case ActionType.REALLOCATE:
          return await this.prepareReallocate(
            logger,
            context,
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
        protocolNetwork: action.protocolNetwork,
      }
    }
  }

  async deployBeforeAllocating(logger: Logger, actions: Action[]): Promise<void> {
    const allocateActions = actions.filter((action) => action.type == ActionType.ALLOCATE)
    logger.info('Ensure subgraph deployments are deployed before we allocate to them', {
      allocateActions,
    })
    const currentAssignments = await this.graphNode.subgraphDeploymentsAssignments(
      SubgraphStatus.ALL,
    )
    await pMap(
      allocateActions,
      async (action: Action) =>
        await this.graphNode.ensure(
          `indexer-agent/${action.deploymentID!.slice(-10)}`,
          new SubgraphDeploymentID(action.deploymentID!),
          currentAssignments,
        ),
      {
        stopOnError: false,
      },
    )
  }

  async prepareAllocateParams(
    logger: Logger,
    context: TransactionPreparationContext,
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
  ): Promise<AllocateTransactionParams> {
    logger.info('Preparing to allocate', {
      deployment: deployment.ipfsHash,
      amount: amount.toString(),
    })

    const allocation = context.activeAllocations.find(
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

    // Check that the subgraph is syncing and healthy before allocating
    // Throw error if:
    //    - subgraph deployment is not syncing,
    const status = context.indexingStatuses.find(
      (status) => status.subgraphDeployment.ipfsHash == deployment.ipfsHash,
    )
    if (!status) {
      throw indexerError(
        IndexerErrorCode.IE077,
        `Subgraph deployment, '${deployment.ipfsHash}', is not syncing`,
      )
    }

    logger.debug('Obtain a unique Allocation ID')
    const { allocationSigner, allocationId } = uniqueAllocationID(
      this.network.transactionManager.wallet.mnemonic.phrase,
      context.currentEpoch.toNumber(),
      deployment,
      context.activeAllocations.map((allocation) => allocation.id),
    )

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
    //
    // in the contracts.
    const state = await this.network.contracts.staking.getAllocationState(allocationId)
    if (state !== 0) {
      logger.debug(`Skipping allocation as it already exists onchain`, {
        indexer: this.network.specification.indexerOptions.address,
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
      indexerAddress: this.network.specification.indexerOptions.address,
    })

    const proof = await allocationIdProof(
      allocationSigner,
      this.network.specification.indexerOptions.address,
      allocationId,
    )

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    return {
      indexer: this.network.specification.indexerOptions.address,
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

    const createAllocationEventLogs = this.network.transactionManager.findEvent(
      'AllocationCreated',
      this.network.contracts.staking.interface,
      'subgraphDeploymentID',
      subgraphDeployment.bytes32,
      receipt,
      this.logger,
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
    await this.network.receiptCollector.rememberAllocations(actionID, [
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
        protocolNetwork: this.network.specification.networkIdentifier,
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
      protocolNetwork: this.network.specification.networkIdentifier,
    }
  }

  async prepareAllocate(
    logger: Logger,
    context: TransactionPreparationContext,
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
  ): Promise<PopulatedTransaction> {
    const params = await this.prepareAllocateParams(logger, context, deployment, amount)
    logger.debug(`Populating allocateFrom transaction`, {
      indexer: params.indexer,
      subgraphDeployment: params.subgraphDeploymentID,
      amount: formatGRT(params.tokens),
      allocation: params.allocationID,
      proof: params.proof,
    })
    return await this.network.contracts.staking.populateTransaction.allocateFrom(
      params.indexer,
      params.subgraphDeploymentID,
      params.tokens,
      params.allocationID,
      params.metadata,
      params.proof,
    )
  }

  async prepareUnallocateParams(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
  ): Promise<UnallocateTransactionParams> {
    logger.info('Preparing to close allocation (unallocate)', {
      allocationID: allocationID,
      poi: poi || 'none provided',
    })
    const allocation = await this.network.networkMonitor.allocation(allocationID)

    poi = await this.network.networkMonitor.resolvePOI(allocation, poi, force)

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
    //
    // in the contracts.
    const state = await this.network.contracts.staking.getAllocationState(allocation.id)
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

    const closeAllocationEventLogs = this.network.transactionManager.findEvent(
      'AllocationClosed',
      this.network.contracts.staking.interface,
      'allocationID',
      allocationID,
      receipt,
      this.logger,
    )

    if (!closeAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Allocation close transaction was never successfully mined`,
      )
    }

    const rewardsEventLogs = this.network.transactionManager.findEvent(
      'RewardsAssigned',
      this.network.contracts.rewardsManager.interface,
      'allocationID',
      allocationID,
      receipt,
      this.logger,
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
      poi: closeAllocationEventLogs.poi,
      transaction: receipt.transactionHash,
      indexingRewards: rewardsAssigned,
    })

    logger.info('Identifying receipts worth collecting', {
      allocation: closeAllocationEventLogs.allocationID,
    })
    const allocation = await this.network.networkMonitor.allocation(allocationID)
    // Collect query fees for this allocation
    const isCollectingQueryFees = await this.network.receiptCollector.collectReceipts(
      actionID,
      allocation,
    )

    // Upsert a rule so the agent keeps the deployment synced but doesn't allocate to it
    logger.debug(
      `Updating indexing rules so indexer-agent keeps the deployment synced but doesn't reallocate to it`,
    )
    const neverIndexingRule = {
      identifier: allocation.subgraphDeployment.id.ipfsHash,
      protocolNetwork: this.network.specification.networkIdentifier,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.NEVER,
    } as Partial<IndexingRuleAttributes>

    await upsertIndexingRule(logger, this.models, neverIndexingRule)

    return {
      actionID,
      type: 'unallocate',
      transactionID: receipt.transactionHash,
      allocation: closeAllocationEventLogs.allocationID,
      allocatedTokens: formatGRT(closeAllocationEventLogs.tokens),
      indexingRewards: formatGRT(rewardsAssigned),
      receiptsWorthCollecting: isCollectingQueryFees,
      protocolNetwork: this.network.specification.networkIdentifier,
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
    return await this.network.contracts.staking.populateTransaction.closeAllocation(
      params.allocationID,
      params.poi,
    )
  }

  async prepareUnallocate(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
  ): Promise<PopulatedTransaction> {
    const params = await this.prepareUnallocateParams(
      logger,
      context,
      allocationID,
      poi,
      force,
    )
    return await this.populateUnallocateTransaction(logger, params)
  }

  async prepareReallocateParams(
    logger: Logger,
    context: TransactionPreparationContext,
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

    // Validate that the allocation exists and is old enough to close
    const allocationAddress = toAddress(allocationID)
    const allocation = context.activeAllocations.find((allocation) => {
      return allocation.id === allocationAddress
    })
    if (!allocation) {
      logger.error(`No existing allocation`)
      throw indexerError(
        IndexerErrorCode.IE063,
        `Reallocation failed: No active allocation with id '${allocationID}' found`,
      )
    }

    logger.debug('Resolving POI', {
      allocation: allocationID,
      deployment: allocation.subgraphDeployment.id.ipfsHash,
    })
    const allocationPOI = await this.network.networkMonitor.resolvePOI(
      allocation,
      poi,
      force,
    )
    logger.debug('POI resolved', {
      deployment: allocation.subgraphDeployment.id.ipfsHash,
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
    const state = await this.network.contracts.staking.getAllocationState(allocation.id)
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

    logger.debug('Generating a new unique Allocation ID')
    const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
      this.network.transactionManager.wallet.mnemonic.phrase,
      context.currentEpoch.toNumber(),
      allocation.subgraphDeployment.id,
      context.activeAllocations.map((allocation) => allocation.id),
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
    const newAllocationState =
      await this.network.contracts.staking.getAllocationState(newAllocationId)
    if (newAllocationState !== 0) {
      logger.warn(`Skipping Allocation as it already exists onchain`, {
        indexer: this.network.specification.indexerOptions.address,
        allocation: newAllocationId,
        newAllocationState,
      })
      throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
    }

    logger.debug('Generating new allocation ID proof', {
      newAllocationSigner: allocationSigner,
      newAllocationID: newAllocationId,
      indexerAddress: this.network.specification.indexerOptions.address,
    })
    const proof = await allocationIdProof(
      allocationSigner,
      this.network.specification.indexerOptions.address,
      newAllocationId,
    )
    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    logger.info(`Prepared close and allocate multicall transaction`, {
      indexer: this.network.specification.indexerOptions.address,
      oldAllocationAmount: formatGRT(allocation.allocatedTokens),
      oldAllocation: allocation.id,
      newAllocation: newAllocationId,
      newAllocationAmount: formatGRT(amount),
      deployment: allocation.subgraphDeployment.id.toString(),
      poi: allocationPOI,
      proof,
      epoch: context.currentEpoch.toString(),
    })

    return {
      closingAllocationID: allocation.id,
      poi: allocationPOI,
      indexer: this.network.specification.indexerOptions.address,
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
    logger.info(`Confirming close and allocate 'multicall' transaction`, {
      allocationID,
    })
    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = this.network.transactionManager.findEvent(
      'AllocationClosed',
      this.network.contracts.staking.interface,
      'allocationID',
      allocationID,
      receipt,
      this.logger,
    )

    if (!closeAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Allocation close transaction was never successfully mined`,
      )
    }

    const createAllocationEventLogs = this.network.transactionManager.findEvent(
      'AllocationCreated',
      this.network.contracts.staking.interface,
      'subgraphDeploymentID',
      closeAllocationEventLogs.subgraphDeploymentID,
      receipt,
      this.logger,
    )

    if (!createAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE014,
        `Allocation create transaction was never mined`,
      )
    }

    const rewardsEventLogs = this.network.transactionManager.findEvent(
      'RewardsAssigned',
      this.network.contracts.rewardsManager.interface,
      'allocationID',
      allocationID,
      receipt,
      this.logger,
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
    let allocation
    let isCollectingQueryFees = false
    try {
      allocation = await this.network.networkMonitor.allocation(allocationID)
      // Collect query fees for this allocation
      isCollectingQueryFees = await this.network.receiptCollector.collectReceipts(
        actionID,
        allocation,
      )
      logger.debug('Finished receipt collection')
    } catch (err) {
      logger.error('Failed to collect receipts', {
        err,
      })
      throw err
    }

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
        protocolNetwork: this.network.specification.networkIdentifier,
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
      protocolNetwork: this.network.specification.networkIdentifier,
    }
  }

  async prepareReallocate(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    amount: BigNumber,
    force: boolean,
  ): Promise<PopulatedTransaction[]> {
    const params = await this.prepareReallocateParams(
      logger,
      context,
      allocationID,
      poi,
      amount,
      force,
    )

    return [
      await this.network.contracts.staking.populateTransaction.closeAllocation(
        params.closingAllocationID,
        params.poi,
      ),
      await this.network.contracts.staking.populateTransaction.allocateFrom(
        params.indexer,
        params.subgraphDeploymentID,
        params.tokens,
        params.newAllocationID,
        params.metadata,
        params.proof,
      ),
    ]
  }

  async matchingRuleExists(
    logger: Logger,
    subgraphDeploymentID: SubgraphDeploymentID,
  ): Promise<boolean> {
    const indexingRules = await fetchIndexingRules(
      this.models,
      true,
      this.network.specification.networkIdentifier,
    )
    const subgraphDeployment = await this.network.networkMonitor.subgraphDeployment(
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
  async stakeUsageSummary(action: Action): Promise<ActionStakeUsageSummary> {
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
      const allocation = await this.network.networkMonitor.allocation(action.allocationID)

      // Accrue rewards, except for zeroed POI
      const zeroHexString = utils.hexlify(Array(32).fill(0))
      rewards =
        action.poi === zeroHexString
          ? BigNumber.from(0)
          : await this.network.contracts.rewardsManager.getRewards(action.allocationID)

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
    const indexerFreeStake = await this.network.contracts.staking.getIndexerCapacity(
      this.network.specification.indexerOptions.address,
    )
    const actionsBatchStakeUsageSummaries = await pMap(batch, async (action: Action) =>
      this.stakeUsageSummary(action),
    )
    const batchDelta: BigNumber = actionsBatchStakeUsageSummaries
      .map((summary: ActionStakeUsageSummary) => summary.balance)
      .reduce((a: BigNumber, b: BigNumber) => a.add(b))
    const indexerNewBalance = indexerFreeStake.sub(batchDelta)

    logger.trace('Action batch stake usage summary', {
      indexerFreeStake: indexerFreeStake.toString(),
      actionsBatchStakeUsageSummaries: actionsBatchStakeUsageSummaries.map((summary) => {
        return {
          action: summary.action,
          allocates: summary.allocates.toString(),
          unallocates: summary.unallocates.toString(),
          rewards: summary.rewards.toString(),
          balance: summary.balance.toString(),
        }
      }),
      batchDelta: batchDelta.toString(),
      indexerNewBalance: indexerNewBalance.toString(),
    })

    if (indexerNewBalance.isNegative()) {
      {
        throw indexerError(
          IndexerErrorCode.IE013,
          `Unfeasible action batch: Approved action batch GRT balance is ` +
            `${formatGRT(batchDelta)} ` +
            `but available stake equals ${formatGRT(indexerFreeStake)}.`,
        )
      }
    }

    /* Return actions sorted by GRT balance (ascending).
     * This ensures on-chain batch feasibility because higher unallocations are processed
     * first and larger allocations are processed last */
    return actionsBatchStakeUsageSummaries
      .sort((a: ActionStakeUsageSummary, b: ActionStakeUsageSummary) =>
        a.balance.gt(b.balance) ? 1 : -1,
      )
      .map((a: ActionStakeUsageSummary) => a.action)
  }
}
