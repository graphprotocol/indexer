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
  MultiNetworks,
  NetworkMapped,
  Network,
  OrderDirection,
  GraphNode,
  sequentialTimerMap,
} from '@graphprotocol/indexer-common'

import { Order, Transaction } from 'sequelize'
import { Eventual, join, Logger } from '@graphprotocol/common-ts'
import groupBy from 'lodash.groupby'

export class ActionManager {
  declare multiNetworks: MultiNetworks<Network>
  declare logger: Logger
  declare models: IndexerManagementModels
  declare allocationManagers: NetworkMapped<AllocationManager>

  executeBatchActionsPromise: Promise<Action[]> | undefined

  static async create(
    multiNetworks: MultiNetworks<Network>,
    logger: Logger,
    models: IndexerManagementModels,
    graphNode: GraphNode,
  ): Promise<ActionManager> {
    const actionManager = new ActionManager()
    actionManager.multiNetworks = multiNetworks
    actionManager.logger = logger.child({ component: 'ActionManager' })
    actionManager.models = models
    actionManager.allocationManagers = await multiNetworks.map(async (network) => {
      return new AllocationManager(
        logger.child({
          component: 'AllocationManager',
          protocolNetwork: network.specification.networkIdentifier,
        }),
        models,
        graphNode,
        network,
      )
    })

    logger.info('Begin monitoring the queue for approved actions to execute')
    await actionManager.monitorQueue()

    return actionManager
  }

  private async batchReady(
    approvedActions: Action[],
    network: Network,
    logger: Logger,
  ): Promise<boolean> {
    logger.info('Batch ready?', {
      approvedActions,
    })

    if (approvedActions.length < 1) {
      logger.info('Batch not ready: No approved actions found')
      return false
    }

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
        if (affectedAllocations[0].isLegacy) {
          const currentEpoch = await network.networkMonitor.currentEpochNumber()
          affectedAllocationExpiring =
            currentEpoch >=
            affectedAllocations[0].createdAtEpoch + Number(maxAllocationDuration.legacy)
        } else {
          // This is not what is described in condition #2 above but it's the closest we can get in Horizon
          // given granularity for allocation expiration is now in seconds and not epochs
          const epochLengthInSeconds = await network.networkMonitor.epochLengthInSeconds()
          const currentTimestamp = Math.floor(Date.now() / 1000)
          affectedAllocationExpiring =
            currentTimestamp >=
            affectedAllocations[0].createdAt +
              Number(maxAllocationDuration.horizon) -
              epochLengthInSeconds
        }
      }

      logger.debug(
        'Auto allocation management executes the batch if at least one requirement is met',
        {
          currentBatchSize: approvedActions.length,
          meetsMinBatchSize,
          oldestAffectedAllocationCreatedAtEpoch:
            affectedAllocations[0]?.createdAtEpoch ??
            'no action in the batch affects existing allocations',
          affectedAllocationExpiring,
        },
      )

      return meetsMinBatchSize || affectedAllocationExpiring
    }

    return true
  }

  async monitorQueue(): Promise<void> {
    const logger = this.logger.child({ component: 'QueueMonitor' })
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
      const approvedActionsByNetwork: NetworkMapped<Action[]> = groupBy(
        approvedActions,
        (action: Action) => action.protocolNetwork,
      )

      await this.multiNetworks.mapNetworkMapped(
        approvedActionsByNetwork,
        async (network: Network, approvedActions: Action[]) => {
          const networkLogger = logger.child({
            protocolNetwork: network.specification.networkIdentifier,
            indexer: network.specification.indexerOptions.address,
            operator: network.transactionManager.wallet.address,
          })

          if (await this.batchReady(approvedActions, network, networkLogger)) {
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
              const attemptedActions = await this.executeApprovedActions(network)
              networkLogger.trace('Attempted to execute all approved actions', {
                actions: attemptedActions,
              })
            } catch (error) {
              networkLogger.error('Failed to execute batch of approved actions', {
                error,
              })
            }
          }
        },
      )
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
          failureReason: isActionFailure(result) ? result.failureReason : null,
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
  async executeApprovedActions(network: Network): Promise<Action[]> {
    if (this.executeBatchActionsPromise) {
      this.logger.warn('Previous batch action execution is still in progress')
      return this.executeBatchActionsPromise
    }

    let updatedActions: Action[] = []
    try {
      this.executeBatchActionsPromise = this.executeApprovedActionsInner(network)
      updatedActions = await this.executeBatchActionsPromise
    } catch (error) {
      this.logger.error(`Failed to execute batch of approved actions -> ${error}`)
    } finally {
      this.executeBatchActionsPromise = undefined
    }
    return updatedActions
  }

  async executeApprovedActionsInner(network: Network): Promise<Action[]> {
    let updatedActions: Action[] = []
    const protocolNetwork = network.specification.networkIdentifier
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
              `${pendingActions} Actions found in PENDING state when execution began. Was there a crash?` +
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

      const allocationManager =
        this.allocationManagers[network.specification.networkIdentifier]

      let results
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
        results = await allocationManager.executeBatch(
          prioritizedActions,
          onFinishedDeploying,
        )
        logger.debug('Completed batch action execution', {
          results,
          endTimeMs: Date.now() - batchStartTime,
        })
      } catch (error) {
        // Release the actions from the PENDING state. This means they will be retried again on the next batch execution.
        logger.error(
          `Error raised during executeBatch, releasing ${prioritizedActions.length} actions from PENDING state. \
          These will be attempted again on the next batch.`,
          error,
        )
        await this.models.Action.sequelize!.transaction(
          { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
          async (transaction) => {
            return await this.markActions(
              prioritizedActions,
              transaction,
              ActionStatus.APPROVED,
            )
          },
        )
        return []
      }

      // Happy path: execution went well (success or failure but no exceptions). Update the actions with the results.
      updatedActions = await this.models.Action.sequelize!.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
        async (transaction) => {
          return await this.updateActionStatusesWithResults(results, transaction)
        },
      )

      logger.debug('Updated action statuses', {
        updatedActions,
        updatedTimeMs: Date.now() - batchStartTime,
      })
    } catch (error) {
      logger.error(`Failed to execute batch tx on staking contract: ${error}`)
      throw indexerError(IndexerErrorCode.IE072, error)
    }

    logger.debug('End executing approved actions')
    return updatedActions
  }

  public static async fetchActions(
    models: IndexerManagementModels,
    transaction: Transaction | null,
    filter: ActionFilter,
    orderBy?: ActionParams,
    orderDirection?: OrderDirection,
    first?: number,
  ): Promise<Action[]> {
    const orderObject: Order = orderBy
      ? [[orderBy.toString(), orderDirection ?? 'desc']]
      : [['id', 'desc']]

    return await models.Action.findAll({
      transaction,
      where: actionFilterToWhereOptions(filter),
      order: orderObject,
      limit: first,
    })
  }

  public static async updateActions(
    models: IndexerManagementModels,
    action: ActionUpdateInput,
    filter: ActionFilter,
  ): Promise<[number, Action[]]> {
    if (Object.keys(filter).length === 0) {
      throw Error(
        'Cannot bulk update actions without a filter, please provide a least 1 filter value',
      )
    }
    return await models.Action.update(
      { ...action },
      {
        where: actionFilterToWhereOptions(filter),
        returning: true,
        validate: true,
      },
    )
  }
}
