import {
  Action,
  ActionFilter,
  ActionStatus,
  IndexerManagementModels,
  isActionFailure,
} from '@graphprotocol/indexer-common'
import { AllocationManager } from './allocations'
import { Transaction } from 'sequelize'
import { Eventual, join, Logger, timer } from '@graphprotocol/common-ts'

export class ActionManager {
  constructor(
    public allocationManager: AllocationManager,
    private logger: Logger,
    private models: IndexerManagementModels,
  ) {}

  async monitorQueue(): Promise<void> {
    const approvedActions: Eventual<Action[]> = timer(30_000).tryMap(
      async () => await this.fetchActions({ status: ActionStatus.APPROVED }),
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (err: any) =>
          this.logger.warn('Failed to fetch approved actions from queue', { err }),
      },
    )

    join({ approvedActions }).pipe(async ({ approvedActions }) => {
      if (approvedActions.length >= 1) {
        this.logger.info('Executing batch of approved actions', {
          actions: approvedActions,
          note: 'If actions were approved very recently they may be missing from this list but will still be taken',
        })

        const attemptedActions = await this.executeApprovedActions()

        this.logger.trace('Attempted to execute all approved actions', {
          actions: attemptedActions,
        })
      }
    })
  }

  async executeApprovedActions(): Promise<Action[]> {
    let updatedActions: Action[] = []

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.models.Action.sequelize!.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (transaction) => {
        // Execute already approved actions first
        const approvedActions = await this.models.Action.findAll({
          where: { status: ActionStatus.APPROVED },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })

        try {
          // This will return all results if successful, if failed it will return the failed actions
          const results = await this.allocationManager.executeBatch(approvedActions)

          this.logger.debug('Completed batch action execution', {
            results,
          })

          for (const result of results) {
            const status = isActionFailure(result)
              ? ActionStatus.FAILED
              : ActionStatus.SUCCESS
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
        } catch (error) {
          this.logger.error(`Failed to execute batch tx on staking contract: ${error}`)
          return []
        }
      },
    )

    return updatedActions
  }

  async fetchActions(filter: ActionFilter): Promise<Action[]> {
    const filterObject = JSON.parse(JSON.stringify(filter))
    const queryResult = await this.models.Action.findAll({
      where: filterObject,
      order: [['updatedAt', 'DESC']],
    })
    return queryResult
  }
}
