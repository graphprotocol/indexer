import {
  Action,
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
} from '@graphprotocol/indexer-common'

import { Order, Transaction, WhereOperators } from 'sequelize'
import { Eventual, join, Logger, timer } from '@graphprotocol/common-ts'
import groupBy from 'lodash.groupby'
import { ActionFilter as GraphQLActionFilter, Maybe } from '../schema/types.generated'

type ActionFilter = GraphQLActionFilter & {
  updatedAt?: WhereOperators
}

export class ActionManager {
  declare multiNetworks: MultiNetworks<Network>
  declare logger: Logger
  declare models: IndexerManagementModels
  declare allocationManagers: NetworkMapped<AllocationManager>

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
        const currentEpoch = await network.networkMonitor.currentEpochNumber()
        const maxAllocationEpoch = await network.networkMonitor.maxAllocationEpoch()
        // affectedAllocations are ordered by creation time so use index 0 for oldest allocation to check expiration
        affectedAllocationExpiring =
          currentEpoch >= affectedAllocations[0].createdAtEpoch + maxAllocationEpoch
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
    const approvedActions: Eventual<Action[]> = timer(30_000).tryMap(
      async () => {
        logger.trace('Fetching approved actions')
        let actions: Action[] = []
        try {
          actions = await ActionManager.fetchActions(
            this.models,
            {
              status: ActionStatus.APPROVED,
            },
            null,
          )
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

  private async updateActionStatuses(
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

  async executeApprovedActions(network: Network): Promise<Action[]> {
    let updatedActions: Action[] = []
    const protocolNetwork = network.specification.networkIdentifier
    const logger = this.logger.child({
      function: 'executeApprovedActions',
      protocolNetwork,
    })

    logger.trace('Begin database transaction for executing approved actions')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.models.Action.sequelize!.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (transaction) => {
        let approvedActions
        try {
          // Execute already approved actions in the order of type and priority.
          // Unallocate actions are prioritized to free up stake that can be used
          // in subsequent reallocate and allocate actions.
          // Reallocate actions are prioritized before allocate as they are for
          // existing syncing deployments with relatively smaller changes made.
          const actionTypePriority = ['unallocate', 'reallocate', 'allocate']
          approvedActions = (
            await this.models.Action.findAll({
              where: {
                status: ActionStatus.APPROVED,
                protocolNetwork,
              },
              order: [['priority', 'ASC']],
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          ).sort(function (a, b) {
            return actionTypePriority.indexOf(a.type) - actionTypePriority.indexOf(b.type)
          })

          if (approvedActions.length === 0) {
            logger.debug('No approved actions were found for this network')
            return []
          }
          logger.debug(
            `Found ${approvedActions.length} approved actions for this network `,
            { approvedActions },
          )
        } catch (error) {
          logger.error('Failed to query approved actions for network', { error })
          return []
        }
        try {
          // This will return all results if successful, if failed it will return the failed actions
          const allocationManager =
            this.allocationManagers[network.specification.networkIdentifier]
          const results = await allocationManager.executeBatch(approvedActions)

          logger.debug('Completed batch action execution', {
            results,
          })
          updatedActions = await this.updateActionStatuses(results, transaction)
        } catch (error) {
          logger.error(`Failed to execute batch tx on staking contract: ${error}`)
          throw indexerError(IndexerErrorCode.IE072, error)
        }
      },
    )
    logger.trace('End database transaction for executing approved actions')
    return updatedActions
  }

  public static async fetchActions(
    models: IndexerManagementModels,
    filter: ActionFilter,
    orderBy: Maybe<ActionParams>,
    orderDirection?: OrderDirection,
    first?: number,
  ): Promise<Action[]> {
    const orderObject: Order = orderBy
      ? [[orderBy.toString(), orderDirection ?? 'desc']]
      : [['id', 'desc']]

    return await models.Action.findAll({
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
    return models.Action.update(
      { ...action },
      {
        where: actionFilterToWhereOptions(filter),
        returning: true,
        validate: true,
      },
    )
  }
}
