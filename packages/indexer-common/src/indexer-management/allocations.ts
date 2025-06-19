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
  legacyAllocationIdProof,
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
  horizonAllocationIdProof,
  POIData,
  ExecuteTransactionResult,
} from '@graphprotocol/indexer-common'
import {
  encodeStartServiceData,
  encodeStopServiceData,
  PaymentTypes,
} from '@graphprotocol/toolshed'
import {
  encodeCollectIndexingRewardsData,
  encodePOIMetadata,
} from '@graphprotocol/toolshed'

import {
  BigNumberish,
  BytesLike,
  ContractTransaction,
  hexlify,
  TransactionReceipt,
  TransactionRequest,
  ZeroAddress,
} from 'ethers'

import pMap from 'p-map'

export interface TransactionPreparationContext {
  activeAllocations: Allocation[]
  recentlyClosedAllocations: Allocation[]
  currentEpoch: bigint
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
  poi: POIData
  isLegacy: boolean
  indexer: string
  actionID: number
  protocolNetwork: string
}

export interface ReallocateTransactionParams {
  closingAllocationID: string
  poi: POIData
  indexer: string
  subgraphDeploymentID: BytesLike
  tokens: BigNumberish
  newAllocationID: string
  metadata: BytesLike
  proof: BytesLike
  closingAllocationIsLegacy: boolean
  actionID: number
  protocolNetwork: string
}

// An Action with resolved Allocation and Unallocation values
export interface ActionStakeUsageSummary {
  action: Action
  allocates: bigint
  unallocates: bigint
  rewards: bigint
  balance: bigint
}

export type PopulateTransactionResult =
  | ActionTransactionRequest
  | ActionTransactionRequest[]
  | ActionFailure

export type ActionTransactionRequest = TransactionRequest & {
  actionID: number
  protocolNetwork: string
}

export type TransactionResult =
  | (TransactionReceipt | 'paused' | 'unauthorized')[]
  | ActionFailure[]

export class AllocationManager {
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private graphNode: GraphNode,
    private network: Network,
  ) { }

  async executeBatch(
    actions: Action[],
    onFinishedDeploying: (actions: Action[]) => Promise<void>,
  ): Promise<AllocationResult[]> {
    const logger = this.logger.child({ function: 'executeBatch' })
    logger.trace('Executing action batch', { actions })
    const result = await this.executeTransactions(actions, onFinishedDeploying)
    return await this.confirmTransactions(result, actions)
  }

  private async executeTransactions(
    actions: Action[],
    onFinishedDeploying: (actions: Action[]) => Promise<void>,
  ): Promise<ExecuteTransactionResult[]> {
    const actionResults: ExecuteTransactionResult[] = []
    const logger = this.logger.child({ function: 'executeTransactions' })
    logger.trace('Begin executing transactions', { actions })
    if (actions.length < 1) {
      throw Error('Failed to populate batch transaction: no transactions supplied')
    }

    const validatedActions = await this.validateActionBatchFeasibilty(actions)
    logger.trace('Validated actions', { validatedActions })

    await this.deployBeforeAllocating(logger, validatedActions)
    await onFinishedDeploying(validatedActions)

    // Populated transaction result for each action
    const populatedActionTransactionsResults = await this.prepareTransactions(validatedActions)
    logger.trace('populatedActionTransactionsResults', { populatedActionTransactionsResults })

    // Flat list of valid prepared transactions
    const preparedTransactions: ActionTransactionRequest[] = []

    for (const populatedActionTransactionResult of populatedActionTransactionsResults) {
      if (isActionFailure(populatedActionTransactionResult)) {
        logger.debug('Failed to prepare action', { populatedActionTransactionResult })
        actionResults.push({
          actionID: populatedActionTransactionResult.actionID,
          success: false,
          result: populatedActionTransactionResult,
        })
      } else {
        if (Array.isArray(populatedActionTransactionResult)) {
          preparedTransactions.push(...populatedActionTransactionResult)
        } else {
          preparedTransactions.push(populatedActionTransactionResult)
        }
      }
    }

    logger.trace('Prepared transactions ', {
      preparedTransactions: preparedTransactions,
    })

    // We need to process both staking contract and subgraph service transactions separately 
    // as they cannot be multicalled
    // Realistically, the only scenario where a batch would have both is shortly after the horizon upgrade
    const stakingTransactions = preparedTransactions.filter(
      (tx: TransactionRequest) =>
        tx.to === this.network.contracts.HorizonStaking.target,
    )
    const subgraphServiceTransactions = preparedTransactions.filter(
      (tx: TransactionRequest) =>
        tx.to === this.network.contracts.SubgraphService.target,
    )

    // -- STAKING CONTRACT --
    const callDataStakingContract = stakingTransactions
      .filter((tx: TransactionRequest) => !!tx.data)
      .map((tx) => tx.data as string)

    logger.debug('Found staking contract transactions', {
      count: callDataStakingContract.length,
    })
    logger.trace('Prepared staking contract transaction calldata', {
      callDataStakingContract,
    })

    if (callDataStakingContract.length > 0) {
      try {
        const stakingTransactionResult = await this.network.transactionManager.executeTransaction(
          async () =>
            this.network.contracts.HorizonStaking.multicall.estimateGas(
              callDataStakingContract,
            ),
          async (gasLimit) =>
            this.network.contracts.HorizonStaking.multicall(callDataStakingContract, {
              gasLimit,
            }),
          this.logger.child({
            actions: `${JSON.stringify(validatedActions.map((action) => action.id))}`,
            function: 'staking.multicall',
          }),
        )

        // Mark all actions with staking contract transactions as successful
        for (const transaction of stakingTransactions) {
          actionResults.push({
            actionID: transaction.actionID,
            success: true,
            result: stakingTransactionResult,
          })
        }
      } catch (error) {
        logger.error('Failed to execute staking contract transaction', { error })

        // Mark all actions with staking contract transactions as failed
        for (const transaction of stakingTransactions) {
          actionResults.push({
            actionID: transaction.actionID,
            success: false,
            result: {
              actionID: transaction.actionID,
              failureReason: `Failed to execute staking contract transaction: ${error.message}`,
              protocolNetwork: transaction.protocolNetwork,
            },
          })
        }
      }
    }

    // -- SUBGRAPH SERVICE --
    const callDataSubgraphService = subgraphServiceTransactions
      // Reallocate of a legacy allocation during the transition period can result in 
      // a staking and subgraph service transaction in the same batch. If the staking tx failed we 
      // should not execute the subgraph service tx.
      .filter((tx: ActionTransactionRequest) => {
        const actionStakingTransaction = actionResults
          .find((result) => result.actionID === tx.actionID)
        return actionStakingTransaction === undefined || actionStakingTransaction.success === true
      })
      .filter((tx: TransactionRequest) => !!tx.data)
      .map((tx) => tx.data as string)
    logger.debug('Found subgraph service transactions', {
      count: callDataSubgraphService.length,
    })
    logger.trace('Prepared subgraph service transaction calldata', {
      callDataSubgraphService,
    })

    if (callDataSubgraphService.length > 0) {
      try {
        const subgraphServiceTransactionResult = await this.network.transactionManager.executeTransaction(
          async () =>
            this.network.contracts.SubgraphService.multicall.estimateGas(
              callDataSubgraphService,
            ),
          async (gasLimit) =>
            this.network.contracts.SubgraphService.multicall(callDataSubgraphService, {
              gasLimit,
            }),
          this.logger.child({
            actions: `${JSON.stringify(validatedActions.map((action) => action.id))}`,
            function: 'subgraphService.multicall',
          }),
        )

        // Mark all actions with subgraph service transactions as successful
        for (const transaction of subgraphServiceTransactions) {
          actionResults.push({
            actionID: transaction.actionID,
            success: true,
            result: subgraphServiceTransactionResult,
          })
        }
      } catch (error) {
        logger.error('Failed to execute subgraph service transaction', { error })

        // Mark all actions with subgraph service transactions as failed
        for (const transaction of subgraphServiceTransactions) {
          actionResults.push({
            actionID: transaction.actionID,
            success: false,
            result: {
              actionID: transaction.actionID,
              failureReason: `Failed to execute subgraph service transaction: ${error.message}`,
              protocolNetwork: transaction.protocolNetwork,
            },
          })
        }
      }
    }

    // sanity check that all actions have a result
    if (actionResults.length !== actions.length) {
      logger.error('Inconsistent number of action results', {
        actionResults: actionResults.length,
        actions: actions.length,
      })
    }

    return actionResults
  }

  async confirmTransactions(
    transactionResults: ExecuteTransactionResult[],
    actions: Action[],
  ): Promise<AllocationResult[]> {
    const logger = this.logger.child({
      function: 'confirmTransactions',
      transactionResults,
    })
    logger.trace('Confirming transactions')

    return pMap(
      transactionResults,
      async (transactionResult: ExecuteTransactionResult) => {

        const action = actions.find((action) => action.id === transactionResult.actionID)
        if (action === undefined) {
          this.logger.error('No action found for transaction result', {
            transactionResult,
          })
          throw new Error('No action found for transaction result')
        }

        if (isActionFailure(transactionResult.result)) {
          logger.debug('Execute batch transaction failed', { actionBatchResult: transactionResult, reason: transactionResult.result.failureReason })
          return transactionResult.result
        }

        if (transactionResult.result === "paused" || transactionResult.result === "unauthorized") {
          logger.debug('Execute batch transaction failed', { actionBatchResult: transactionResult, reason: transactionResult.result })
          return {
            actionID: transactionResult.actionID,
            transactionID: undefined,
            failureReason: transactionResult.result,
            protocolNetwork: action.protocolNetwork,
          }
        }

        const receipt = transactionResult.result

        try {
          if (receipt === undefined) {
            this.logger.error('No receipt found for action', {
              action: transactionResult.actionID,
            })
            throw new Error('No receipt found for action')
          }

          return await this.confirmActionExecution(receipt, action)
        } catch (error) {
          let transaction: string | undefined = undefined
          if (typeof receipt == 'object') {
            transaction = receipt.hash ?? undefined
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
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
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
    const currentEpoch = await this.network.contracts.EpochManager.currentEpoch()
    const context: TransactionPreparationContext = {
      activeAllocations: await this.network.networkMonitor.allocations(
        AllocationStatus.ACTIVE,
      ),
      recentlyClosedAllocations:
        await this.network.networkMonitor.recentlyClosedAllocations(
          Number(currentEpoch),
          2,
        ),
      currentEpoch,
      indexingStatuses: await this.graphNode.indexingStatus(
        actions.map((action) => new SubgraphDeploymentID(action.deploymentID!)),
      ),
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
            action.id,
            action.protocolNetwork,
          )
        case ActionType.UNALLOCATE:
          return await this.prepareUnallocate(
            logger,
            context,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            action.allocationID!,
            action.poi === null ? undefined : action.poi,
            action.force === null ? false : action.force,
            action.poiBlockNumber === null ? undefined : action.poiBlockNumber,
            action.publicPOI === null ? undefined : action.publicPOI,
            action.id,
            action.protocolNetwork,
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
            action.poiBlockNumber === null ? undefined : action.poiBlockNumber,
            action.publicPOI === null ? undefined : action.publicPOI,
            action.id,
            action.protocolNetwork,
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
    const currentAssignments =
      await this.graphNode.subgraphDeploymentAssignmentsByDeploymentID(
        SubgraphStatus.ALL,
        actions.map((action) => action.deploymentID!),
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
    amount: bigint,
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

    if (amount < 0n) {
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
    const activeAndRecentlyClosedAllocations: Allocation[] = [
      ...context.recentlyClosedAllocations,
      ...context.activeAllocations,
    ]
    const { allocationSigner, allocationId } = uniqueAllocationID(
      this.network.transactionManager.wallet.mnemonic!.phrase,
      Number(context.currentEpoch),
      deployment,
      activeAndRecentlyClosedAllocations.map((allocation) => allocation.id),
    )

    logger.debug('New unique Allocation ID generated', {
      newAllocationID: allocationId,
      newAllocationSigner: allocationSigner,
    })

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    let allocationExistsSubgraphService = false
    let allocationExistsStaking = false
    const isHorizon = await this.network.isHorizon.value()
    if (isHorizon) {
      const allocation =
        await this.network.contracts.SubgraphService.getAllocation(allocationId)
      const legacyAllocation =
        await this.network.contracts.SubgraphService.getLegacyAllocation(allocationId)
      allocationExistsSubgraphService = allocation.createdAt !== 0n
      allocationExistsStaking = legacyAllocation.indexer !== ZeroAddress
    } else {
      const state =
        await this.network.contracts.LegacyStaking.getAllocationState(allocationId)
      allocationExistsStaking = state !== 0n
    }

    if (allocationExistsSubgraphService || allocationExistsStaking) {
      logger.debug(`Skipping allocation as it already exists onchain`, {
        indexer: this.network.specification.indexerOptions.address,
        allocation: allocationId,
        isHorizon,
        allocationExistsSubgraphService,
        allocationExistsStaking,
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

    const proof = isHorizon
      ? await horizonAllocationIdProof(
        allocationSigner,
        Number(this.network.specification.networkIdentifier.split(':')[1]),
        this.network.specification.indexerOptions.address,
        allocationId,
        this.network.contracts.SubgraphService.target.toString(),
      )
      : await legacyAllocationIdProof(
        allocationSigner,
        this.network.specification.indexerOptions.address,
        allocationId,
      )

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
      isLegacy: !isHorizon,
    })

    return {
      indexer: this.network.specification.indexerOptions.address,
      subgraphDeploymentID: deployment.bytes32,
      tokens: amount,
      allocationID: allocationId,
      metadata: hexlify(new Uint8Array(32).fill(0)),
      proof,
    }
  }

  async confirmAllocate(
    actionID: number,
    deployment: string,
    amount: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<CreateAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    const subgraphDeployment = new SubgraphDeploymentID(deployment)
    const isLegacy =
      (receipt as TransactionReceipt).to === this.network.contracts.HorizonStaking.target
    logger.info(`Confirming allocation creation transaction`, {
      isLegacy,
    })
    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,

        `Allocation not created. ${receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
        }`,
      )
    }

    const createAllocationEventLogs = isLegacy
      ? this.network.transactionManager.findEvent(
        'AllocationCreated',
        this.network.contracts.LegacyStaking.interface,
        'subgraphDeploymentID',
        subgraphDeployment.bytes32,
        receipt,
        this.logger,
      )
      : this.network.transactionManager.findEvent(
        'AllocationCreated',
        this.network.contracts.SubgraphService.interface,
        'indexer',
        this.network.specification.indexerOptions.address,
        receipt,
        logger,
      )

    if (!createAllocationEventLogs) {
      throw indexerError(IndexerErrorCode.IE014, `Allocation was never mined`)
    }

    logger.info(`Successfully allocated to subgraph deployment`, {
      amountGRT: formatGRT(createAllocationEventLogs.tokens),
      allocation: isLegacy
        ? createAllocationEventLogs.allocationID
        : createAllocationEventLogs.allocationId,
      deployment: createAllocationEventLogs.subgraphDeploymentID,
      epoch: isLegacy
        ? createAllocationEventLogs.epoch.toString()
        : createAllocationEventLogs.currentEpoch.toString(),
      isLegacy,
    })

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
      transactionID: receipt.hash,
      deployment: deployment,
      allocation: isLegacy
        ? createAllocationEventLogs.allocationID
        : createAllocationEventLogs.allocationId,
      allocatedTokens: amount,
      protocolNetwork: this.network.specification.networkIdentifier,
    }
  }

  async prepareAllocate(
    logger: Logger,
    context: TransactionPreparationContext,
    deployment: SubgraphDeploymentID,
    amount: bigint,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ActionTransactionRequest> {
    const isHorizon = await this.network.isHorizon.value()
    const params = await this.prepareAllocateParams(logger, context, deployment, amount)
    logger.debug(`Populating allocation creation transaction`, {
      indexer: params.indexer,
      subgraphDeployment: params.subgraphDeploymentID,
      amount: formatGRT(params.tokens),
      allocation: params.allocationID,
      proof: params.proof,
      isLegacy: !isHorizon,
    })

    let populatedTransaction: ContractTransaction
    if (isHorizon) {
      const encodedData = encodeStartServiceData(
        params.subgraphDeploymentID.toString(),
        BigInt(params.tokens),
        params.allocationID,
        params.proof.toString(),
      )
      populatedTransaction =
        await this.network.contracts.SubgraphService.startService.populateTransaction(
          params.indexer,
          encodedData,
        )
    } else {
      populatedTransaction =
        await this.network.contracts.LegacyStaking.allocateFrom.populateTransaction(
          params.indexer,
          params.subgraphDeploymentID,
          params.tokens,
          params.allocationID,
          params.metadata,
          params.proof,
        )
    }
    return {
      protocolNetwork,
      actionID,
      ...populatedTransaction,
    }
  }

  async prepareUnallocateParams(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
    poiBlockNumber: number | undefined,
    publicPOI: string | undefined,
    actionID: number,
    protocolNetwork: string,
  ): Promise<UnallocateTransactionParams> {
    logger.info('Preparing to unallocate', {
      allocationID: allocationID,
      poi: poi || 'none provided',
      publicPOI: publicPOI || 'none provided',
      poiBlockNumber: poiBlockNumber || 'none provided',
    })
    const allocation = await this.network.networkMonitor.allocation(allocationID)

    const poiData = await this.network.networkMonitor.resolvePOI(
      allocation,
      poi,
      publicPOI,
      poiBlockNumber,
      force,
    )

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    if (allocation.isLegacy) {
      const state = await this.network.contracts.HorizonStaking.getAllocationState(
        allocation.id,
      )
      if (state !== 1n) {
        throw indexerError(IndexerErrorCode.IE065)
      }
    } else {
      const allocation =
        await this.network.contracts.SubgraphService.getAllocation(allocationID)
      if (allocation.closedAt !== 0n) {
        throw indexerError(IndexerErrorCode.IE065)
      }
    }

    return {
      protocolNetwork,
      actionID,
      allocationID: allocation.id,
      poi: poiData,
      isLegacy: allocation.isLegacy,
      indexer: allocation.indexer,
    }
  }

  async confirmUnallocate(
    actionID: number,
    allocationID: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<CloseAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    const isLegacy =
      (receipt as TransactionReceipt).to === this.network.contracts.HorizonStaking.target
    const isHorizon = await this.network.isHorizon.value()

    logger.info(`Confirming unallocate transaction`, {
      isLegacy,
    })

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = isLegacy
      ? this.network.transactionManager.findEvent(
        'AllocationClosed',
        this.network.contracts.LegacyStaking.interface,
        'allocationID',
        allocationID,
        receipt,
        this.logger,
      )
      : this.network.transactionManager.findEvent(
        'AllocationClosed',
        this.network.contracts.SubgraphService.interface,
        'allocationId',
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

    const rewardsEventLogs = isLegacy
      ? this.network.transactionManager.findEvent(
        isHorizon ? 'HorizonRewardsAssigned' : 'RewardsAssigned',
        this.network.contracts.RewardsManager.interface,
        'allocationID',
        allocationID,
        receipt,
        this.logger,
      )
      : this.network.transactionManager.findEvent(
        'IndexingRewardsCollected',
        this.network.contracts.SubgraphService.interface,
        'allocationId',
        allocationID,
        receipt,
        this.logger,
      )

    const rewardsAssigned = rewardsEventLogs
      ? isLegacy
        ? rewardsEventLogs.amount
        : rewardsEventLogs.tokensIndexerRewards
      : 0

    if (rewardsAssigned == 0) {
      logger.warn('No rewards were distributed upon closing the allocation')
    }

    const subgraphDeploymentID = new SubgraphDeploymentID(
      isLegacy
        ? closeAllocationEventLogs.subgraphDeploymentID
        : closeAllocationEventLogs.subgraphDeploymentId,
    )

    logger.info(`Successfully closed allocation`, {
      deployment: subgraphDeploymentID.display,
      allocation: allocationID,
      indexer: closeAllocationEventLogs.indexer,
      amountGRT: formatGRT(closeAllocationEventLogs.tokens),
      transaction: receipt.hash,
      indexingRewards: rewardsAssigned,
    })

    logger.info('Identifying receipts worth collecting', {
      allocation: allocationID,
    })
    const allocation = await this.network.networkMonitor.allocation(allocationID)

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
      transactionID: receipt.hash,
      allocation: allocationID,
      allocatedTokens: formatGRT(closeAllocationEventLogs.tokens),
      indexingRewards: formatGRT(rewardsAssigned),
      protocolNetwork: this.network.specification.networkIdentifier,
    }
  }

  async populateUnallocateTransaction(
    logger: Logger,
    params: UnallocateTransactionParams,
  ): Promise<ActionTransactionRequest> {
    logger.debug(`Populating unallocate transaction`, {
      allocationID: params.allocationID,
      poiData: params.poi,
    })

    if (params.isLegacy) {
      const tx = await this.network.contracts.HorizonStaking.closeAllocation.populateTransaction(
        params.allocationID,
        params.poi.poi,
      )
      return {
        protocolNetwork: params.protocolNetwork,
        actionID: params.actionID,
        ...tx,
      }
    } else {
      // Horizon: Need to multicall collect and stopService

      // collect
      const collectIndexingRewardsData = encodeCollectIndexingRewardsData(
        params.allocationID,
        params.poi.poi,
        encodePOIMetadata(
          params.poi.blockNumber,
          params.poi.publicPOI,
          params.poi.indexingStatus,
          0,
          0,
        ),
      )
      const collectCallData =
        this.network.contracts.SubgraphService.interface.encodeFunctionData('collect', [
          params.indexer,
          PaymentTypes.IndexingRewards,
          collectIndexingRewardsData,
        ])

      // stopService
      const stopServiceCallData =
        this.network.contracts.SubgraphService.interface.encodeFunctionData(
          'stopService',
          [params.indexer, encodeStopServiceData(params.allocationID)],
        )

      const tx = await this.network.contracts.SubgraphService.multicall.populateTransaction([
        collectCallData,
        stopServiceCallData,
      ])
      return {
        protocolNetwork: params.protocolNetwork,
        actionID: params.actionID,
        ...tx,
      }
    }
  }

  async prepareUnallocate(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
    poiBlockNumber: number | undefined,
    publicPOI: string | undefined,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ActionTransactionRequest> {
    const params = await this.prepareUnallocateParams(
      logger,
      context,
      allocationID,
      poi,
      force,
      poiBlockNumber,
      publicPOI,
      actionID,
      protocolNetwork,
    )
    return await this.populateUnallocateTransaction(logger, params)
  }

  async prepareReallocateParams(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    amount: bigint,
    force: boolean,
    poiBlockNumber: number | undefined,
    publicPOI: string | undefined,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ReallocateTransactionParams> {
    logger.info('Preparing to reallocate', {
      allocation: allocationID,
      poi: poi || 'none provided',
      publicPOI: publicPOI || 'none provided',
      poiBlockNumber: poiBlockNumber || 'none provided',
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
    const poiData = await this.network.networkMonitor.resolvePOI(
      allocation,
      poi,
      publicPOI,
      poiBlockNumber,
      force,
    )
    logger.debug('POI resolved', {
      deployment: allocation.subgraphDeployment.id.ipfsHash,
      userProvidedPOI: poi,
      userProvidedPublicPOI: publicPOI,
      userProvidedBlockNumber: poiBlockNumber,
      poi: poiData.poi,
      publicPOI: poiData.publicPOI,
      blockNumber: poiData.blockNumber,
      force,
    })

    // Double-check whether the allocation is still active on chain, to
    // avoid unnecessary transactions.
    if (allocation.isLegacy) {
      const state = await this.network.contracts.HorizonStaking.getAllocationState(
        allocation.id,
      )
      if (state !== 1n) {
        logger.warn(`Allocation has already been closed`)
        throw indexerError(
          IndexerErrorCode.IE065,
          `Legacy allocation has already been closed`,
        )
      }
    } else {
      const allocationData =
        await this.network.contracts.SubgraphService.getAllocation(allocationID)
      if (allocationData.closedAt !== 0n) {
        logger.warn(`Allocation has already been closed`)
        throw indexerError(IndexerErrorCode.IE065, `Allocation has already been closed`)
      }
    }

    if (amount < 0n) {
      logger.warn('Cannot reallocate a negative amount of GRT', {
        amount: amount.toString(),
      })
      throw indexerError(
        IndexerErrorCode.IE061,
        'Cannot reallocate a negative amount of GRT',
      )
    }

    logger.debug('Generating a new unique Allocation ID')
    const activeAndRecentlyClosedAllocations: Allocation[] = [
      ...context.recentlyClosedAllocations,
      ...context.activeAllocations,
    ]
    const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
      this.network.transactionManager.wallet.mnemonic!.phrase,
      Number(context.currentEpoch),
      allocation.subgraphDeployment.id,
      activeAndRecentlyClosedAllocations.map((allo) => allo.id),
    )

    logger.debug('New unique Allocation ID generated', {
      newAllocationID: newAllocationId,
      newAllocationSigner: allocationSigner,
    })

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    const isHorizon = await this.network.isHorizon.value()
    if (isHorizon) {
      const allocationData =
        await this.network.contracts.SubgraphService.getAllocation(newAllocationId)
      if (allocationData.createdAt !== 0n) {
        logger.warn(`Skipping allocation as it already exists onchain`, {
          indexer: this.network.specification.indexerOptions.address,
          allocation: newAllocationId,
          allocationData,
          isHorizon,
        })
        throw indexerError(IndexerErrorCode.IE066, 'AllocationID already exists')
      }
    } else {
      const newAllocationState =
        await this.network.contracts.HorizonStaking.getAllocationState(newAllocationId)
      if (newAllocationState !== 0n) {
        logger.warn(`Skipping allocation as it already exists onchain (legacy)`, {
          indexer: this.network.specification.indexerOptions.address,
          allocation: newAllocationId,
          newAllocationState,
          isHorizon,
        })
        throw indexerError(IndexerErrorCode.IE066, 'Legacy AllocationID already exists')
      }
    }

    logger.debug('Generating new allocation ID proof', {
      newAllocationSigner: allocationSigner,
      newAllocationID: newAllocationId,
      indexerAddress: this.network.specification.indexerOptions.address,
      isHorizon,
    })
    const proof = isHorizon
      ? await horizonAllocationIdProof(
        allocationSigner,
        Number(this.network.specification.networkIdentifier.split(':')[1]),
        this.network.specification.indexerOptions.address,
        newAllocationId,
        this.network.contracts.SubgraphService.target.toString(),
      )
      : await legacyAllocationIdProof(
        allocationSigner,
        this.network.specification.indexerOptions.address,
        newAllocationId,
      )

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
      isHorizon,
    })

    logger.info(`Prepared close and allocate multicall transaction`, {
      indexer: this.network.specification.indexerOptions.address,
      oldAllocationAmount: formatGRT(allocation.allocatedTokens),
      oldAllocation: allocation.id,
      newAllocation: newAllocationId,
      newAllocationAmount: formatGRT(amount),
      deployment: allocation.subgraphDeployment.id.toString(),
      poi: poiData,
      proof,
      epoch: context.currentEpoch.toString(),
    })

    return {
      closingAllocationID: allocation.id,
      closingAllocationIsLegacy: allocation.isLegacy,
      poi: poiData,
      indexer: this.network.specification.indexerOptions.address,
      subgraphDeploymentID: allocation.subgraphDeployment.id.bytes32,
      tokens: amount,
      newAllocationID: newAllocationId,
      metadata: hexlify(new Uint8Array(32).fill(0)),
      proof,
      actionID,
      protocolNetwork,
    }
  }

  async confirmReallocate(
    actionID: number,
    allocationID: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<ReallocateAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    const isHorizon = await this.network.isHorizon.value()

    // This could be a tx to the staking contract or the subgraph service contract
    const isStakingContract =
      (receipt as TransactionReceipt).to === this.network.contracts.HorizonStaking.target

    logger.info(`Confirming reallocate transaction`, {
      allocationID,
      isHorizon,
      isStakingContract,
    })

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    let closeAllocationEventLogs
    let createAllocationEventLogs
    let subgraphDeploymentID
    let rewardsAssigned

    if (isStakingContract) {
      // tx to the staking contract can be one of the following:
      // - closeAllocation for a legacy allocation
      // - allocateFrom for a legacy allocation before horizon

      closeAllocationEventLogs = this.network.transactionManager.findEvent(
        'AllocationClosed',
        this.network.contracts.LegacyStaking.interface,
        'allocationID',
        allocationID,
        receipt,
        this.logger,
      )

      if (!closeAllocationEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE015,
          `Legacy allocation close transaction was never successfully mined`,
        )
      }

      if (!isHorizon) {
        createAllocationEventLogs = this.network.transactionManager.findEvent(
          'AllocationCreated',
          this.network.contracts.LegacyStaking.interface,
          'subgraphDeploymentID',
          closeAllocationEventLogs.subgraphDeploymentID,
          receipt,
          this.logger,
        )

        if (!createAllocationEventLogs) {
          throw indexerError(
            IndexerErrorCode.IE014,
            `Legacy allocation create transaction was never mined`,
          )
        }
      }

      const rewardsEventLogs = this.network.transactionManager.findEvent(
        isHorizon ? 'HorizonRewardsAssigned' : 'RewardsAssigned',
        this.network.contracts.RewardsManager.interface,
        'allocationID',
        allocationID,
        receipt,
        this.logger,
      )

      rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.amount : 0

      if (rewardsAssigned == 0) {
        logger.warn('No rewards were distributed upon closing the legacy allocation')
      }

      subgraphDeploymentID = new SubgraphDeploymentID(
        closeAllocationEventLogs.subgraphDeploymentID,
      )
    } else {
      // tx to the subgraph service contract can be one of the following:
      // - collect + stopService for a new allocation
      // - startService for a new allocation

      closeAllocationEventLogs = this.network.transactionManager.findEvent(
        'AllocationClosed',
        this.network.contracts.SubgraphService.interface,
        'allocationId',
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
        'IndexingRewardsCollected',
        this.network.contracts.SubgraphService.interface,
        'allocationId',
        allocationID,
        receipt,
        this.logger,
      )

      rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.tokensIndexerRewards : 0

      if (rewardsAssigned == 0) {
        logger.warn('No rewards were distributed upon closing the allocation')
      }

      createAllocationEventLogs = this.network.transactionManager.findEvent(
        'AllocationCreated',
        this.network.contracts.SubgraphService.interface,
        'indexer',
        this.network.specification.indexerOptions.address,
        receipt,
        logger,
      )

      if (!createAllocationEventLogs) {
        throw indexerError(IndexerErrorCode.IE014, `Allocation was never mined`)
      }

      subgraphDeploymentID = new SubgraphDeploymentID(
        closeAllocationEventLogs.subgraphDeploymentId,
      )
    }

    logger.info(`Successfully reallocated to deployment`, {
      deployment: subgraphDeploymentID.display,
      closedAllocation: allocationID,
      closedAllocationStakeGRT: formatGRT(closeAllocationEventLogs.tokens),
      indexingRewardsCollected: formatGRT(rewardsAssigned),
      createdAllocation: createAllocationEventLogs.allocationID,
      createdAllocationStakeGRT: formatGRT(createAllocationEventLogs.tokens),
      indexer: createAllocationEventLogs.indexer,
      transaction: receipt.hash,
    })

    logger.info('Identifying receipts worth collecting', {
      allocation: closeAllocationEventLogs.allocationID,
    })
    const allocation = await this.network.networkMonitor.allocation(allocationID)

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
      transactionID: receipt.hash,
      closedAllocation: closeAllocationEventLogs.allocationID,
      indexingRewardsCollected: formatGRT(rewardsAssigned),
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
    amount: bigint,
    force: boolean,
    poiBlockNumber: number | undefined,
    publicPOI: string | undefined,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ActionTransactionRequest[]> {
    const params = await this.prepareReallocateParams(
      logger,
      context,
      allocationID,
      poi,
      amount,
      force,
      poiBlockNumber,
      publicPOI,
      actionID,
      protocolNetwork,
    )

    return this.populateReallocateTransaction(logger, params)
  }

  async populateReallocateTransaction(
    logger: Logger,
    params: ReallocateTransactionParams,
  ): Promise<ActionTransactionRequest[]> {
    logger.debug('Populating reallocate transaction', {
      closingAllocationID: params.closingAllocationID,
      poi: params.poi,
      indexer: params.indexer,
      subgraphDeploymentID: params.subgraphDeploymentID,
      tokens: params.tokens,
      newAllocationID: params.newAllocationID,
      metadata: params.metadata,
      proof: params.proof,
    })

    const txs: TransactionRequest[] = []

    // -- close allocation
    if (params.closingAllocationIsLegacy) {
      txs.push(
        await this.network.contracts.LegacyStaking.closeAllocation.populateTransaction(
          params.closingAllocationID,
          params.poi.poi,
        ),
      )
    } else {
      // Horizon: Need to multicall collect and stopService

      // collect
      const collectIndexingRewardsData = encodeCollectIndexingRewardsData(
        params.closingAllocationID,
        params.poi.poi,
        encodePOIMetadata(
          params.poi.blockNumber,
          params.poi.publicPOI,
          params.poi.indexingStatus,
          0,
          0,
        ),
      )
      const collectCallData =
        this.network.contracts.SubgraphService.interface.encodeFunctionData('collect', [
          params.indexer,
          PaymentTypes.IndexingRewards,
          collectIndexingRewardsData,
        ])

      // stopService
      const stopServiceCallData =
        this.network.contracts.SubgraphService.interface.encodeFunctionData(
          'stopService',
          [params.indexer, encodeStopServiceData(params.closingAllocationID)],
        )

      txs.push(
        await this.network.contracts.SubgraphService.multicall.populateTransaction([
          collectCallData,
          stopServiceCallData,
        ]),
      )
    }

    // -- create new allocation
    const isHorizon = await this.network.isHorizon.value()
    if (isHorizon) {
      const encodedData = encodeStartServiceData(
        params.subgraphDeploymentID.toString(),
        BigInt(params.tokens),
        params.newAllocationID,
        params.proof.toString(),
      )
      txs.push(
        await this.network.contracts.SubgraphService.startService.populateTransaction(
          params.indexer,
          encodedData,
        ),
      )
    } else {
      txs.push(
        await this.network.contracts.LegacyStaking.allocateFrom.populateTransaction(
          params.indexer,
          params.subgraphDeploymentID,
          params.tokens,
          params.newAllocationID,
          params.metadata,
          params.proof,
        ),
      )
    }

    return txs.map((tx) => ({
      actionID: params.actionID,
      protocolNetwork: params.protocolNetwork,
      ...tx,
    }))
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
    let unallocates = 0n
    let rewards = 0n

    // Handle allocations
    let allocates
    if (action.amount) {
      allocates = parseGRT(action.amount)
    } else {
      allocates = 0n
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
      const zeroHexString = hexlify(new Uint8Array(32).fill(0))
      rewards =
        action.poi === zeroHexString
          ? 0n
          : await this.network.contracts.RewardsManager.getRewards(
            this.network.contracts.HorizonStaking.target,
            action.allocationID,
          )

      unallocates = unallocates + allocation.allocatedTokens
    }

    const balance = allocates - unallocates - rewards
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

    // Validate stake feasibility - we need to analyse stake depending on the action type
    const indexerFreeStake = await this.network.networkMonitor.freeStake()

    const actionsBatchStakeUsageSummaries = await pMap(batch, async (action: Action) =>
      this.stakeUsageSummary(action),
    )
    const batchDeltaLegacy = actionsBatchStakeUsageSummaries
      .filter((summary: ActionStakeUsageSummary) => summary.action.isLegacy)
      .map((summary: ActionStakeUsageSummary) => summary.balance)
      .reduce((a: bigint, b: bigint) => a + b, 0n)
    const batchDelta = actionsBatchStakeUsageSummaries
      .filter((summary: ActionStakeUsageSummary) => !summary.action.isLegacy)
      .map((summary: ActionStakeUsageSummary) => summary.balance)
      .reduce((a: bigint, b: bigint) => a + b, 0n)

    const indexerNewBalance = indexerFreeStake.horizon - batchDelta
    const indexerNewBalanceLegacy = indexerFreeStake.legacy - batchDeltaLegacy

    logger.trace('Action batch stake usage summary', {
      indexerFreeStake: indexerFreeStake.toString(),
      indexerFreeStakeLegacy: indexerFreeStake.legacy.toString(),
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
      batchDeltaLegacy: batchDeltaLegacy.toString(),
      indexerNewBalance: indexerNewBalance.toString(),
      indexerNewBalanceLegacy: indexerNewBalanceLegacy.toString(),
    })

    if (indexerNewBalance < 0n || indexerNewBalanceLegacy < 0n) {
      {
        throw indexerError(
          IndexerErrorCode.IE013,
          `Unfeasible action batch: Approved action batch GRT balance is ` +
          `${formatGRT(batchDelta)} for horizon actions and ` +
          `${formatGRT(batchDeltaLegacy)} for legacy actions ` +
          `but available horizon stake equals ${formatGRT(indexerFreeStake.horizon)} ` +
          `and legacy stake equals ${formatGRT(indexerFreeStake.legacy)}.`,
        )
      }
    }

    /* Return actions sorted by GRT balance (ascending).
     * This ensures on-chain batch feasibility because higher unallocations are processed
     * first and larger allocations are processed last */
    return actionsBatchStakeUsageSummaries
      .sort((a: ActionStakeUsageSummary, b: ActionStakeUsageSummary) =>
        a.balance > b.balance ? 1 : -1,
      )
      .map((a: ActionStakeUsageSummary) => a.action)
  }
}
