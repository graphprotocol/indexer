import {
  Action,
  ActionFilter,
  actionFilterToWhereOptions,
  ActionParams,
  ActionStatus,
  ActionUpdateInput,
  AllocationManager,
  AllocationManagementMode,
  AllocationResult,
  AllocationStatus,
  indexerError,
  IndexerErrorCode,
  IndexerManagementModels,
  isActionFailure,
  Network,
  OrderDirection,
  GraphNode,
  sequentialTimerMap,
} from '@graphprotocol/indexer-common'

import { Order, Transaction } from 'sequelize'
import { Eventual, join, Logger } from '@graphprotocol/common-ts'

export class ActionManager {
  declare network: Network
  declare logger: Logger
  declare models: IndexerManagementModels
  declare allocationManager: AllocationManager

  executeBatchActionsPromise: Promise<Action[]> | undefined

  static async create(
    network: Network,
    logger: Logger,
    models: IndexerManagementModels,
    graphNode: GraphNode,
  ): Promise<ActionManager> {
    const actionManager = new ActionManager()
    actionManager.network = network
    actionManager.logger = logger.child({ component: 'ActionManager' })
    actionManager.models = models
    actionManager.allocationManager = new AllocationManager(
      logger.child({
        component: 'AllocationManager',
        protocolNetwork: network.specification.networkIdentifier,
      }),
      models,
      graphNode,
      network,
    )

    logger.info('Begin monitoring the queue for approved actions to execute')
    await actionManager.monitorQueue()

    return actionManager
  }

  private async batchReady(approvedActions: Action[], logger: Logger): Promise<boolean> {
    logger.info('Batch ready?', {
      approvedActions,
    })

    if (approvedActions.length < 1) {
      logger.info('Batch not ready: No approved actions found')
      return false
    }

    const network = this.network

    // In auto management mode the worker will execute the batch if:
    // 1) Number of approved actions >= minimum batch size
    // or 2) Oldest affected allocation will expiring after the current epoch
    if (
      network.specification.indexerOptions.allocationManagementMode ===
      AllocationManagementMode.AUTO
    ) {
      const meetsMinBatchSize =
        approvedActions.length >=
        (network.specification.indexerOptions.autoAllocationMinBatchSize ?? 1)

      const approvedDeploymentIDs = approvedActions.map((action) => action.deploymentID)
      const affectedAllocations = (
        await network.networkMonitor.allocations(AllocationStatus.ACTIVE)
      ).filter((a) => approvedDeploymentIDs.includes(a.subgraphDeployment.id.ipfsHash))
      let affectedAllocationExpiring = false
      if (affectedAllocations.length) {
        const maxAllocationDuration = await network.networkMonitor.maxAllocationDuration()

        // affectedAllocations are ordered by creation time so use index 0 for oldest allocation to check expiration
        const currentEpoch = await network.networkMonitor.currentEpochNumber()
        affectedAllocationExpiring =
          currentEpoch >=
          affectedAllocations[0].createdAtEpoch +
            (affectedAllocations[0].isLegacy
              ? maxAllocationDuration.legacy
              : maxAllocationDuration.horizon)
      }

      logger.debug(
        'Auto allocation management executes the batch if at least one requirement is met',
        {
          currentBatchSize: approvedActions.length,
          meetsMinBatchSize,
          oldestAffectedAllocationCreatedAtEpoch:
            affectedAllocations[0]?.createdAtEpoch ??
            'no action in the batch affects existing allocations',
          oldestAffectedAllocationIsLegacy: affectedAllocations[0]?.isLegacy,
          affectedAllocationExpiring,
        },
      )

      return meetsMinBatchSize || affectedAllocationExpiring
    }

    return true
  }

  async monitorQueue(): Promise<void> {
    const logger = this.logger.child({ component: 'QueueMonitor' })
    const network = this.network
    const protocolNetwork = network.specification.networkIdentifier

    const approvedActions: Eventual<Action[]> = sequentialTimerMap(
      {
        logger,
        milliseconds: 30_000,
      },
      async () => {
        logger.trace('Fetching approved actions')
        let actions: Action[] = []
        try {
          actions = await ActionManager.fetchActions(this.models, null, {
            status: [ActionStatus.APPROVED, ActionStatus.DEPLOYING],
            protocolNetwork,
          })
          logger.trace(`Fetched ${actions.length} approved actions`)
        } catch (err) {
          logger.warn('Failed to fetch approved actions from queue', { err })
        }

        return actions
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (err: any) =>
          logger.warn('Failed to fetch approved actions from queue', { err }),
      },
    )

    join({ approvedActions }).pipe(async ({ approvedActions }) => {
      logger.debug('Approved actions found, evaluating batch')

      const networkLogger = logger.child({
        protocolNetwork: network.specification.networkIdentifier,
        indexer: network.specification.indexerOptions.address,
        operator: network.transactionManager.wallet.address,
      })

      if (await this.batchReady(approvedActions, networkLogger)) {
        const paused = await network.paused.value()
        const isOperator = await network.isOperator.value()
        networkLogger.debug('Batch ready, preparing to execute', {
          paused,
          isOperator,
          protocolNetwork: network.specification.networkIdentifier,
        })
        // Do nothing else if the network is paused
        if (paused) {
          networkLogger.info(
            `The network is currently paused, not doing anything until it resumes`,
          )
          return
        }

        // Do nothing if we're not authorized as an operator for the indexer
        if (!isOperator) {
          networkLogger.error(`Not authorized as an operator for the indexer`, {
            err: indexerError(IndexerErrorCode.IE034),
          })
          return
        }

        networkLogger.info('Executing batch of approved actions', {
          actions: approvedActions,
          note: 'If actions were approved very recently they may be missing from this batch',
        })

        try {
          const attemptedActions = await this.executeApprovedActions()
          networkLogger.trace('Attempted to execute all approved actions', {
            actions: attemptedActions,
          })
        } catch (error) {
          networkLogger.error('Failed to execute batch of approved actions', {
            error,
          })
        }
      }
    })
  }

  /**
   * Mark actions with the given status.
   * @param actions
   * @param transaction
   * @param status
   * @returns updated actions
   * @throws error if the update fails
   */
  private async markActions(
    actions: Action[],
    transaction: Transaction,
    status: ActionStatus,
  ): Promise<Action[]> {
    const ids = actions.map((action) => action.id)
    const [, updatedActions] = await this.models.Action.update(
      {
        status,
      },
      {
        where: { id: ids },
        returning: true,
        transaction,
      },
    )
    return updatedActions
  }

  /**
   * Update the action statuses from the results provided by execution.
   *
   * @param results
   * @param transaction
   * @returns updated actions
   */
  private async updateActionStatusesWithResults(
    results: AllocationResult[],
    transaction: Transaction,
  ): Promise<Action[]> {
    let updatedActions: Action[] = []
    for (const result of results) {
      const status = isActionFailure(result) ? ActionStatus.FAILED : ActionStatus.SUCCESS
      const [, updatedAction] = await this.models.Action.update(
        {
          status: status,
          transaction: result.transactionID,
          // truncate failure reason to 1000 characters
          // avoids SequelizeDatabaseError: value too long for type character varying(1000)
          failureReason: isActionFailure(result)
            ? result.failureReason.substring(0, 1000)
            : null,
        },
        {
          where: { id: result.actionID },
          returning: true,
          transaction,
        },
      )
      updatedActions = updatedActions.concat(updatedAction)
    }
    return updatedActions
  }

  // a promise guard to ensure that only one batch of actions is executed at a time
  async executeApprovedActions(): Promise<Action[]> {
    if (this.executeBatchActionsPromise) {
      this.logger.warn('Previous batch action execution is still in progress')
      return this.executeBatchActionsPromise
    }

    let updatedActions: Action[] = []
    try {
      this.executeBatchActionsPromise = this.executeApprovedActionsInner()
      updatedActions = await this.executeBatchActionsPromise
    } catch (error) {
      this.logger.error(`Failed to execute batch of approved actions -> ${error}`)
    } finally {
      this.executeBatchActionsPromise = undefined
    }
    return updatedActions
  }

  async executeApprovedActionsInner(): Promise<Action[]> {
    let updatedActions: Action[] = []
    const protocolNetwork = this.network.specification.networkIdentifier
    const logger = this.logger.child({
      function: 'executeApprovedActions',
      protocolNetwork,
    })

    logger.debug('Begin executing approved actions')
    let batchStartTime

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const prioritizedActions: Action[] = await this.models.Action.sequelize!.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (transaction) => {
        batchStartTime = Date.now()
        let approvedAndDeployingActions
        try {
          // Execute already approved actions in the order of type and priority.
          // Unallocate actions are prioritized to free up stake that can be used
          // in subsequent reallocate and allocate actions.
          // Reallocate actions are prioritized before allocate as they are for
          // existing syncing deployments with relatively smaller changes made.
          const actionTypePriority = ['unallocate', 'reallocate', 'allocate']
          approvedAndDeployingActions = (
            await this.models.Action.findAll({
              where: {
                status: [ActionStatus.APPROVED, ActionStatus.DEPLOYING],
                protocolNetwork,
              },
              order: [['priority', 'ASC']],
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          ).sort(function (a, b) {
            return actionTypePriority.indexOf(a.type) - actionTypePriority.indexOf(b.type)
          })

          const pendingActions = await this.models.Action.findAll({
            where: { status: ActionStatus.PENDING, protocolNetwork },
            order: [['priority', 'ASC']],
            transaction,
          })
          if (pendingActions.length > 0) {
            logger.warn(
              `${pendingActions.length} Actions found in PENDING state when execution began. Was there a crash? ` +
                `These indicate that execution was interrupted while calling contracts, and will need to be cleared manually.`,
            )
          }

          if (approvedAndDeployingActions.length === 0) {
            logger.debug('No approved actions were found for this network')
            return []
          }
          logger.debug(
            `Found ${approvedAndDeployingActions.length} approved actions for this network `,
            { approvedActions: approvedAndDeployingActions },
          )
        } catch (error) {
          logger.error('Failed to query approved actions for network', { error })
          return []
        }
        // mark all approved actions as DEPLOYING, this serves as a lock on other processing of them
        await this.markActions(
          approvedAndDeployingActions,
          transaction,
          ActionStatus.DEPLOYING,
        )
        return approvedAndDeployingActions
      },
    )

    try {
      logger.debug('Executing batch action', {
        prioritizedActions,
        startTimeMs: Date.now() - batchStartTime,
      })

      let results: AllocationResult[]
      try {
        // TODO: we should lift the batch execution (graph-node, then contracts) up to here so we can
        // mark the actions appropriately
        const onFinishedDeploying = async (validatedActions) => {
          // After we ensure that we have finished deploying new subgraphs (and possibly their dependencies) to graph-node,
          // we can mark the actions as PENDING.
          logger.debug('Finished deploying actions, marking as PENDING')
          this.models.Action.sequelize!.transaction(
            { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
            async (transaction) => {
              return await this.markActions(
                validatedActions,
                transaction,
                ActionStatus.PENDING,
              )
            },
          )
        }
        // This will return all results if successful, if failed it will return the failed actions
        results = await this.allocationManager.executeBatch(
          prioritizedActions,
          onFinishedDeploying,
        )
      } catch (error) {
        logger.error('Failed to execute batch of approved actions', { error })
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.models.Action.sequelize!.transaction(
          { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
          async (transaction) => {
            await this.markActions(prioritizedActions, transaction, ActionStatus.APPROVED)
          },
        )
        return []
      }
      logger.debug('Finished executing batch of approved actions', {
        results,
        elapsedMs: Date.now() - batchStartTime,
      })
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.Action.sequelize!.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
        async (transaction) => {
          updatedActions = await this.updateActionStatusesWithResults(
            results,
            transaction,
          )
        },
      )
    } catch (error) {
      logger.error('Failed to execute batch of approved actions', { error })
    }
    return updatedActions
  }

  static async fetchActions(
    models: IndexerManagementModels,
    orderBy: ActionParams | null,
    filter?: ActionFilter,
    first?: number,
    orderDirection?: OrderDirection,
  ): Promise<Action[]> {
    const order: Order | undefined = orderBy
      ? [[orderBy.toString(), orderDirection ?? 'desc']]
      : undefined
    const whereClause = filter ? actionFilterToWhereOptions(filter) : undefined
    const limit = first ?? undefined
    return await models.Action.findAll({
      order,
      where: whereClause,
      limit,
    })
  }

  static async updateActions(
    models: IndexerManagementModels,
    action: ActionUpdateInput,
    filter: ActionFilter,
  ): Promise<[number, Action[]]> {
    return await models.Action.update(action, {
      where: actionFilterToWhereOptions(filter),
      returning: true,
    })
  }
}
