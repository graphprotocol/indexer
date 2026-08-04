import {
  formatGRT,
  Logger,
  parseGRT,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import {
  Action,
  ActionFailure,
  ActionType,
  Allocation,
  AllocationResult,
  AllocationStatus,
  CloseAllocationResult,
  CreateAllocationResult,
  DipsManager,
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
  preprocessRules,
  Network,
  PresentPOIResult,
  ResizeAllocationResult,
  SubgraphIdentifierType,
  SubgraphStatus,
  uniqueAllocationID,
  upsertIndexingRule,
  horizonAllocationIdProof,
  POIData,
  ExecuteActionResult,
  isPartialActionFailure,
} from '@graphprotocol/indexer-common'
import {
  encodeStartServiceData,
  encodeStopServiceData,
  PaymentTypes,
} from '@graphprotocol/toolshed'
import { PendingRcaProposal } from './models/pending-rca-proposal'
import {
  encodeCollectIndexingRewardsData,
  encodePOIMetadata,
} from '@graphprotocol/toolshed'

import {
  BigNumberish,
  BytesLike,
  hexlify,
  TransactionReceipt,
  TransactionRequest,
  ZeroAddress,
} from 'ethers'

import pMap from 'p-map'
import { tryParseCustomError } from '../utils'

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

export interface PresentPOITransactionParams {
  allocationID: string
  poi: POIData
  indexer: string
  actionID: number
  protocolNetwork: string
}

export interface ResizeTransactionParams {
  allocationID: string
  newAmount: bigint
  indexer: string
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

/**
 * Encodes collect indexing rewards data for Horizon allocations.
 * Shared helper used by collect and unallocate operations.
 */
export function encodeCollectData(allocationId: string, poiData: POIData): string {
  const encodedPOIMetadata = encodePOIMetadata(
    poiData.blockNumber,
    poiData.publicPOI,
    poiData.indexingStatus,
    0,
    0,
  )
  return encodeCollectIndexingRewardsData(allocationId, poiData.poi, encodedPOIMetadata)
}

// The rule stamped after a close must not overwrite a DIPS rule: the DIPS module
// reads both `never` and `offchain` as a blocklist that cancels agreements
// on-chain. Ending an agreement stays explicit (`rules never`), not a side effect.
export function ruleAfterClose(
  existingRule: IndexingRuleAttributes | null,
  deployment: SubgraphDeploymentID,
  protocolNetwork: string,
  decisionBasis: IndexingDecisionBasis.NEVER | IndexingDecisionBasis.OFFCHAIN,
): Partial<IndexingRuleAttributes> | null {
  if (existingRule?.decisionBasis === IndexingDecisionBasis.DIPS) {
    return null
  }
  return {
    identifier: deployment.ipfsHash,
    protocolNetwork,
    identifierType: SubgraphIdentifierType.DEPLOYMENT,
    decisionBasis,
  }
}

export class AllocationManager {
  declare dipsManager: DipsManager | null
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private graphNode: GraphNode,
    private network: Network,
    private pendingRcaModel: typeof PendingRcaProposal,
  ) {
    if (this.network.specification.indexerOptions.enableDips) {
      // Construction is intentionally side-effect-free: the agent owns
      // when the accept/sweep loops start so short-lived consumers (CLI,
      // jest setups) don't leak background timers.
      this.dipsManager = new DipsManager(
        this.logger,
        this.models,
        this.network,
        this.graphNode,
        this,
        this.pendingRcaModel,
      )
    }
  }

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
  ): Promise<ExecuteActionResult[]> {
    const actionResults: ExecuteActionResult[] = []
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
    const populatedActionTransactionsResults =
      await this.prepareTransactions(validatedActions)
    logger.trace('populatedActionTransactionsResults', {
      populatedActionTransactionsResults,
    })

    // Flat list of valid prepared transactions
    const preparedTransactions: ActionTransactionRequest[] = []

    for (const populatedActionTransactionResult of populatedActionTransactionsResults) {
      if (isActionFailure(populatedActionTransactionResult)) {
        logger.debug('Failed to prepare action', { populatedActionTransactionResult })
        actionResults.push({
          actionID: populatedActionTransactionResult.actionID,
          success: false,
          result: [populatedActionTransactionResult],
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

    // Guard against a future prepared transaction targeting something other
    // than SubgraphService — its calldata must not slip into the multicall.
    const callDataSubgraphService = preparedTransactions
      .filter(
        (tx: TransactionRequest) =>
          tx.to === this.network.contracts.SubgraphService.target && !!tx.data,
      )
      .map((tx) => tx.data as string)

    logger.debug('Found subgraph service transactions', {
      count: callDataSubgraphService.length,
    })
    logger.trace('Prepared subgraph service transaction calldata', {
      callDataSubgraphService,
    })

    if (callDataSubgraphService.length > 0) {
      try {
        const subgraphServiceTransactionResult =
          await this.network.transactionManager.executeTransaction(
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

        this.processActionResults(
          actionResults,
          preparedTransactions,
          subgraphServiceTransactionResult,
        )
      } catch (error) {
        const parsedError = tryParseCustomError(error)
        logger.error('Failed to execute subgraph service transaction', {
          error: parsedError,
        })
        this.processActionResults(actionResults, preparedTransactions, {
          failureReason: `Failed to execute subgraph service transaction: ${
            typeof parsedError === 'string' ? parsedError : error.message
          }`,
        })
      }
    }

    // sanity check that all actions have a result
    if (actionResults.length !== actions.length) {
      logger.error('Inconsistent number of action results', {
        actionResultsCount: actionResults.length,
        actionsCount: actions.length,
        actionResults,
        actions,
      })
    }

    return actionResults
  }

  /**
   * Record a per-action result from a transaction-batch outcome.
   *
   * @param actionResults - List to append results into
   * @param transactions - The transactions whose outcome we're recording
   * @param transactionResult - The receipt (or failure) returned by the batch
   */
  processActionResults(
    actionResults: ExecuteActionResult[],
    transactions: ActionTransactionRequest[],
    transactionResult:
      | Partial<ActionFailure>
      | TransactionReceipt
      | 'paused'
      | 'unauthorized',
  ) {
    const actionFailed = isPartialActionFailure(transactionResult)
    const buildActionFailureResult = (tx: ActionTransactionRequest): ActionFailure => ({
      actionID: tx.actionID,
      failureReason:
        (transactionResult as Partial<ActionFailure>).failureReason ??
        'Unknown failure reason',
      protocolNetwork: tx.protocolNetwork,
    })

    for (const transaction of transactions) {
      actionResults.push(
        actionFailed
          ? {
              actionID: transaction.actionID,
              success: false,
              result: [buildActionFailureResult(transaction)],
            }
          : {
              actionID: transaction.actionID,
              success: true,
              result: [transactionResult],
            },
      )
    }
  }

  /**
   * Confirm a batch of executed actions by inspecting each transaction outcome.
   *
   * @param actionResults - The per-action outcomes produced by executeTransactions
   * @param actions - The original actions being confirmed
   */
  async confirmTransactions(
    actionResults: ExecuteActionResult[],
    actions: Action[],
  ): Promise<AllocationResult[]> {
    const logger = this.logger.child({
      function: 'confirmTransactions',
      actionResults: actionResults,
    })
    logger.trace('Confirming transactions')

    return pMap(
      actionResults,
      async (actionResult: ExecuteActionResult) => {
        const action = actions.find((action) => action.id === actionResult.actionID)
        if (action === undefined) {
          this.logger.error('No action found for action result', {
            actionResult,
          })
          throw new Error('No action found for action result')
        }

        if (actionResult.result.length === 0) {
          logger.error('No transaction result recorded for action', {
            actionResult,
          })
          return {
            actionID: actionResult.actionID,
            transactionID: undefined,
            failureReason: 'No transaction result recorded for action',
            protocolNetwork: action.protocolNetwork,
          }
        }

        const outcome = actionResult.result[0]

        if (isActionFailure(outcome)) {
          logger.debug('Execute action failed', {
            actionBatchResult: actionResult,
            reason: outcome.failureReason,
          })
          return outcome
        }

        if (outcome === 'paused' || outcome === 'unauthorized') {
          logger.debug('Execute batch transaction failed', {
            actionBatchResult: actionResult,
            reason: outcome,
          })
          return {
            actionID: actionResult.actionID,
            transactionID: undefined,
            failureReason: outcome,
            protocolNetwork: action.protocolNetwork,
          }
        }

        try {
          return await this.confirmActionExecution(outcome, action)
        } catch (error) {
          this.logger.error('Failed to confirm batch transaction', {
            error,
          })
          return {
            actionID: action.id,
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

  /**
   * Confirm the execution of a single action using its transaction receipt.
   *
   * @param receipt - The receipt for the action's transaction
   * @param action - The action being confirmed
   */
  async confirmActionExecution(
    receipt: TransactionReceipt,
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
      case ActionType.PRESENT_POI:
        return await this.confirmPresentPOI(
          action.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.allocationID!,
          receipt,
        )
      case ActionType.RESIZE:
        return await this.confirmResize(
          action.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.allocationID!,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          action.amount!,
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
        case ActionType.PRESENT_POI:
          return await this.preparePresentPOI(
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
        case ActionType.RESIZE:
          return await this.prepareResize(
            logger,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            action.allocationID!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            parseGRT(action.amount!),
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
    const onChainAllocation =
      await this.network.contracts.SubgraphService.getAllocation(allocationId)
    const legacyAllocation =
      await this.network.contracts.SubgraphService.getLegacyAllocation(allocationId)
    const allocationExistsSubgraphService = onChainAllocation.createdAt !== 0n
    const allocationExistsStaking = legacyAllocation.indexer !== ZeroAddress

    if (allocationExistsSubgraphService || allocationExistsStaking) {
      logger.debug(`Skipping allocation as it already exists onchain`, {
        indexer: this.network.specification.indexerOptions.address,
        allocation: allocationId,
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

    const proof = await horizonAllocationIdProof(
      allocationSigner,
      Number(this.network.specification.networkIdentifier.split(':')[1]),
      this.network.specification.indexerOptions.address,
      allocationId,
      this.network.contracts.SubgraphService.target.toString(),
    )

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
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
    logger.info(`Confirming allocation creation transaction`)
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
      allocation: createAllocationEventLogs.allocationId,
      deployment: createAllocationEventLogs.subgraphDeploymentID,
      epoch: createAllocationEventLogs.currentEpoch.toString(),
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
      allocation: createAllocationEventLogs.allocationId,
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
    const params = await this.prepareAllocateParams(logger, context, deployment, amount)
    logger.debug(`Populating allocation creation transaction`, {
      indexer: params.indexer,
      subgraphDeployment: params.subgraphDeploymentID,
      amount: formatGRT(params.tokens),
      allocation: params.allocationID,
      proof: params.proof,
    })

    // Fail automatically if the indexer is not registered
    const registrationData = await this.network.contracts.SubgraphService.indexers(
      params.indexer,
    )
    if (registrationData.url.length === 0) {
      throw indexerError(IndexerErrorCode.IE086)
    }
    const encodedData = encodeStartServiceData(
      params.subgraphDeploymentID.toString(),
      BigInt(params.tokens),
      params.allocationID,
      params.proof.toString(),
    )
    const populatedTransaction =
      await this.network.contracts.SubgraphService.startService.populateTransaction(
        params.indexer,
        encodedData,
      )
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

    const presentPOIParams = await this.preparePresentPOIParams(
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
    return {
      ...presentPOIParams,
      isLegacy: false,
    }
  }

  async confirmUnallocate(
    actionID: number,
    allocationID: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<CloseAllocationResult> {
    const logger = this.logger.child({ action: actionID })
    logger.info(`Confirming unallocate transaction`)

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation '${allocationID}' could not be closed: ${receipt}`,
      )
    }

    const closeAllocationEventLogs = this.network.transactionManager.findEvent(
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

    const rewardsAssigned = rewardsEventLogs ? rewardsEventLogs.tokensIndexerRewards : 0

    if (rewardsAssigned == 0) {
      logger.warn('No rewards were distributed upon closing the allocation')
    }

    const subgraphDeploymentID = new SubgraphDeploymentID(
      closeAllocationEventLogs.subgraphDeploymentId,
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
      `Updating indexing rules so indexer-agent keeps the deployment synced but doesn't allocate to it`,
    )
    const existingRule = await this.models.IndexingRule.findOne({
      where: {
        identifier: allocation.subgraphDeployment.id.ipfsHash,
        protocolNetwork: this.network.specification.networkIdentifier,
      },
    })
    const neverIndexingRule = ruleAfterClose(
      existingRule,
      allocation.subgraphDeployment.id,
      this.network.specification.networkIdentifier,
      IndexingDecisionBasis.NEVER,
    )

    if (neverIndexingRule) {
      await upsertIndexingRule(logger, this.models, neverIndexingRule)
    } else {
      logger.info(
        `Deployment is managed by an indexing agreement, keeping its DIPS rule instead of stamping never`,
        { deployment: allocation.subgraphDeployment.id.ipfsHash },
      )
    }

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

    // Need to collect indexing rewards and stop service
    // Check if indexer is over-allocated - if so, collect() will auto-close the allocation
    // and we should NOT call stopService to avoid "AllocationClosed" revert
    const isOverAllocated = await this.network.contracts.SubgraphService.isOverAllocated(
      params.indexer,
    )

    logger.debug('Checking over-allocation status for unallocate', {
      allocationID: params.allocationID,
      isOverAllocated,
    })

    if (isOverAllocated) {
      // Reuse populatePresentPOITransaction - collect will auto-close the allocation
      logger.info(
        'Indexer is over-allocated, using collect-only transaction (allocation will auto-close)',
        { allocationID: params.allocationID },
      )
      return await this.populatePresentPOITransaction(logger, params)
    }

    // Normal path: multicall collect + stopService
    const collectData = encodeCollectData(params.allocationID, params.poi)
    const collectCallData =
      this.network.contracts.SubgraphService.interface.encodeFunctionData('collect', [
        params.indexer,
        PaymentTypes.IndexingRewards,
        collectData,
      ])

    const stopServiceCallData =
      this.network.contracts.SubgraphService.interface.encodeFunctionData('stopService', [
        params.indexer,
        encodeStopServiceData(params.allocationID),
      ])

    const tx = await this.network.contracts.SubgraphService.multicall.populateTransaction(
      [collectCallData, stopServiceCallData],
    )
    return {
      protocolNetwork: params.protocolNetwork,
      actionID: params.actionID,
      ...tx,
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

  // ---- PRESENT_POI (rewards only, no close) ----

  async preparePresentPOIParams(
    logger: Logger,
    context: TransactionPreparationContext,
    allocationID: string,
    poi: string | undefined,
    force: boolean,
    poiBlockNumber: number | undefined,
    publicPOI: string | undefined,
    actionID: number,
    protocolNetwork: string,
  ): Promise<PresentPOITransactionParams> {
    logger.info('Preparing to present POI (collect indexing rewards without closing)', {
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

    // Double-check whether the allocation is still active on chain
    const allocationData =
      await this.network.contracts.SubgraphService.getAllocation(allocationID)
    if (allocationData.closedAt !== 0n) {
      throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
    }

    return {
      protocolNetwork,
      actionID,
      allocationID: allocation.id,
      poi: poiData,
      indexer: allocation.indexer,
    }
  }

  async populatePresentPOITransaction(
    logger: Logger,
    params: PresentPOITransactionParams,
  ): Promise<ActionTransactionRequest> {
    logger.debug(`Populating present-poi transaction (rewards only)`, {
      allocationID: params.allocationID,
      poiData: params.poi,
    })

    // Present POI and collect indexing rewards without closing the allocation
    const collectData = encodeCollectData(params.allocationID, params.poi)

    const tx = await this.network.contracts.SubgraphService.collect.populateTransaction(
      params.indexer,
      PaymentTypes.IndexingRewards,
      collectData,
    )

    return {
      protocolNetwork: params.protocolNetwork,
      actionID: params.actionID,
      ...tx,
    }
  }

  async preparePresentPOI(
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
    const params = await this.preparePresentPOIParams(
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
    return await this.populatePresentPOITransaction(logger, params)
  }

  async confirmPresentPOI(
    actionID: number,
    allocationID: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<PresentPOIResult> {
    const logger = this.logger.child({ action: actionID })

    logger.info(`Confirming present-poi transaction (rewards only)`, {
      allocationID,
    })

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Present POI for allocation '${allocationID}' failed: ${receipt}`,
      )
    }

    const collectEventLogs = this.network.transactionManager.findEvent(
      'ServicePaymentCollected',
      this.network.contracts.SubgraphService.interface,
      'serviceProvider',
      this.network.specification.indexerOptions.address,
      receipt,
      this.logger,
    )

    if (!collectEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        `Present POI transaction was never successfully mined`,
      )
    }

    const rewardsCollected = collectEventLogs.tokens ?? 0n

    logger.info(`Successfully presented POI and collected indexing rewards`, {
      allocation: allocationID,
      indexingRewards: formatGRT(rewardsCollected),
      transaction: receipt.hash,
    })

    return {
      actionID,
      type: 'presentPOI',
      transactionID: receipt.hash,
      allocation: allocationID,
      indexingRewardsCollected: formatGRT(rewardsCollected),
      protocolNetwork: this.network.specification.networkIdentifier,
    }
  }

  // ---- RESIZE (change allocation stake without closing) ----

  async prepareResizeParams(
    logger: Logger,
    allocationID: string,
    newAmount: bigint,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ResizeTransactionParams> {
    logger.info('Preparing to resize allocation', {
      allocationID,
      newAmount: newAmount.toString(),
    })

    // Validate the allocation is still active on chain
    const allocationData =
      await this.network.contracts.SubgraphService.getAllocation(allocationID)
    if (allocationData.closedAt !== 0n) {
      throw indexerError(IndexerErrorCode.IE065, 'Allocation has already been closed')
    }

    // Validate amount is positive
    if (newAmount <= 0n) {
      throw indexerError(
        IndexerErrorCode.IE061,
        `Invalid resize amount: ${newAmount.toString()}. Amount must be positive.`,
      )
    }

    return {
      protocolNetwork,
      actionID,
      allocationID,
      newAmount,
      indexer: allocationData.indexer,
    }
  }

  async populateResizeTransaction(
    logger: Logger,
    params: ResizeTransactionParams,
  ): Promise<ActionTransactionRequest> {
    logger.debug('Populating resize allocation transaction', {
      allocationID: params.allocationID,
      newAmount: params.newAmount.toString(),
    })

    try {
      // Call SubgraphService.resizeAllocation(indexer, allocationId, tokens)
      const tx =
        await this.network.contracts.SubgraphService.resizeAllocation.populateTransaction(
          params.indexer,
          params.allocationID,
          params.newAmount,
        )

      return {
        protocolNetwork: params.protocolNetwork,
        actionID: params.actionID,
        ...tx,
      }
    } catch (error) {
      logger.error('Failed to populate resize transaction', {
        allocationID: params.allocationID,
        newAmount: params.newAmount.toString(),
        error,
      })
      throw indexerError(
        IndexerErrorCode.IE087,
        `Failed to prepare resize transaction for allocation '${params.allocationID}': ${error}`,
      )
    }
  }

  async prepareResize(
    logger: Logger,
    allocationID: string,
    newAmount: bigint,
    actionID: number,
    protocolNetwork: string,
  ): Promise<ActionTransactionRequest> {
    const params = await this.prepareResizeParams(
      logger,
      allocationID,
      newAmount,
      actionID,
      protocolNetwork,
    )
    return await this.populateResizeTransaction(logger, params)
  }

  async confirmResize(
    actionID: number,
    allocationID: string,
    newAmount: string,
    receipt: TransactionReceipt | 'paused' | 'unauthorized',
  ): Promise<ResizeAllocationResult> {
    const logger = this.logger.child({ action: actionID })

    logger.info('Confirming resize allocation transaction', {
      allocationID,
    })

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Resize allocation '${allocationID}' failed: ${receipt}`,
      )
    }

    // Look for AllocationResized event from SubgraphService
    const resizeEventLogs = this.network.transactionManager.findEvent(
      'AllocationResized',
      this.network.contracts.SubgraphService.interface,
      'allocationId',
      allocationID,
      receipt,
      this.logger,
    )

    if (!resizeEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE015,
        'Resize allocation transaction was never successfully mined',
      )
    }

    const previousAmount = resizeEventLogs.oldTokens ?? 0n
    const actualNewAmount = resizeEventLogs.newTokens ?? 0n

    logger.info('Successfully resized allocation', {
      allocation: allocationID,
      previousAmount: formatGRT(previousAmount),
      newAmount: formatGRT(actualNewAmount),
      transaction: receipt.hash,
    })

    const allocation = await this.network.networkMonitor.allocation(allocationID)
    const subgraphDeploymentID = new SubgraphDeploymentID(
      allocation.subgraphDeployment.id.ipfsHash,
    )

    // If there is not yet an indexingRule that deems this deployment worth allocating to, make one
    if (!(await this.matchingRuleExists(logger, subgraphDeploymentID))) {
      logger.debug(
        `No matching indexing rule found; updating indexing rules so indexer-agent will now manage the active allocation`,
      )
      const indexingRule = {
        identifier: allocation.subgraphDeployment.id.ipfsHash,
        allocationAmount: formatGRT(actualNewAmount),
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        protocolNetwork: this.network.specification.networkIdentifier,
      } as Partial<IndexingRuleAttributes>

      await upsertIndexingRule(logger, this.models, indexingRule)
    }

    return {
      actionID,
      type: 'resize',
      transactionID: receipt.hash,
      allocation: allocationID,
      previousAmount: formatGRT(previousAmount),
      newAmount: formatGRT(actualNewAmount),
      protocolNetwork: this.network.specification.networkIdentifier,
    }
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
    // Use preprocessed rules for O(1) lookup
    const { deploymentRulesMap, globalRule } = preprocessRules(indexingRules)
    return isDeploymentWorthAllocatingTowards(
      logger,
      subgraphDeployment,
      deploymentRulesMap,
      globalRule,
    ).toAllocate
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

    if (action.type === ActionType.UNALLOCATE || action.type === ActionType.RESIZE) {
      // Ensure this Action have a valid allocationID
      if (action.allocationID === null || action.allocationID === undefined) {
        throw Error(
          `SHOULD BE UNREACHABLE: Unallocate or Resize action must have an allocationID field: ${action}`,
        )
      }

      // Fetch the allocation on chain to inspect its amount
      const allocation = await this.network.networkMonitor.allocation(action.allocationID)

      // RESIZE doesn't close the allocation, so no rewards are collected
      if (action.type !== ActionType.RESIZE) {
        // Accrue rewards, except for zeroed POI
        const zeroHexString = hexlify(new Uint8Array(32).fill(0))
        if (action.poi === zeroHexString) {
          rewards = 0n
        } else {
          rewards = await this.network.contracts.RewardsManager.getRewards(
            this.network.contracts.SubgraphService.target,
            action.allocationID,
          )
        }
      }

      unallocates = unallocates + allocation.allocatedTokens
    }

    // Calculate stake delta: positive means net allocation, negative means net release.
    // For RESIZE: balance = newAmount - currentAmount (negative when downsizing).
    // For UNALLOCATE: balance = 0 - currentAmount - rewards (always negative).
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
    const batchDelta = actionsBatchStakeUsageSummaries
      .map((summary: ActionStakeUsageSummary) => summary.balance)
      .reduce((a: bigint, b: bigint) => a + b, 0n)

    const indexerNewBalance = indexerFreeStake - batchDelta

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

    if (indexerNewBalance < 0n) {
      throw indexerError(
        IndexerErrorCode.IE013,
        `Unfeasible action batch: Approved action batch GRT balance is ` +
          `${formatGRT(batchDelta)} ` +
          `but available stake equals ${formatGRT(indexerFreeStake)}.`,
      )
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
