/* eslint-disable @typescript-eslint/ban-types */

import { IndexerManagementResolverContext } from '../client'
import { Logger } from '@graphprotocol/common-ts'
import {
  Action,
  ActionFilter,
  ActionInput,
  ActionParams,
  ActionResult,
  ActionStatus,
  ActionType,
  IndexerManagementModels,
  OrderDirection,
  validateActionInputs,
} from '@graphprotocol/indexer-common'
import { Op, Transaction } from 'sequelize'

const indexerAgent = 'indexerAgent'

// Perform insert, update, or no-op depending on existing queue data
// INSERT - No item in the queue yet targeting this deploymentID
// UPDATE - Already an item in the queue targeting the same deploymentID AND that item was added by the same 'source'
// NO-OP - Already an item in the queue targeting the same deploymentID BUT was added by a different source
// TODO: Use pending status for actions in process of execution, detect here and if duplicate pending found, NOOP
async function executeQueueOperation(
  logger: Logger,
  action: ActionInput,
  actionsAwaitingExecution: Action[],
  recentlyFailedActions: Action[],
  models: IndexerManagementModels,
  transaction: Transaction,
): Promise<ActionResult[]> {
  // Check for previously failed conflicting actions
  const conflictingActions = recentlyFailedActions.filter(function (failed) {
    const areEqual = compareFailedActions(failed, action)
    const fromAgent = failed.source === indexerAgent && action.source === indexerAgent
    return areEqual && fromAgent
  })
  if (conflictingActions.length > 0) {
    const message = `Recently failed '${action.type}' action found in queue targeting '${action.deploymentID}', ignoring.`
    logger.warn(message, {
      actionInQueue: conflictingActions,
      proposedAction: action,
    })
    throw Error(message)
  }

  // Check for duplicated actions
  const duplicateActions = actionsAwaitingExecution.filter(
    (a) => a.deploymentID === action.deploymentID,
  )
  if (duplicateActions.length === 0) {
    return [
      await models.Action.create(action, {
        validate: true,
        returning: true,
        transaction,
      }),
    ]
  } else if (duplicateActions.length === 1) {
    if (
      duplicateActions[0].source === action.source &&
      duplicateActions[0].status === action.status
    ) {
      // TODO: Log this only when update will actually change existing item
      logger.info(
        `Action found in queue that effects the same deployment as proposed queue action, updating existing action`,
        {
          actionInQueue: duplicateActions,
          proposedAction: action,
          proposedSource: action.source,
          actionSources: duplicateActions[0].source,
        },
      )
      const [, updatedAction] = await models.Action.update(
        { ...action },
        {
          where: { id: duplicateActions[0].id },
          returning: true,
          validate: true,
          transaction,
        },
      )
      return updatedAction
    } else {
      const message =
        `Duplicate action found in queue that effects '${action.deploymentID}' but NOT overwritten because it has a different source and/or status. If you ` +
        `would like to replace the item currently in the queue please cancel it and then queue the proposed action`
      logger.warn(message, {
        actionInQueue: duplicateActions,
        proposedAction: action,
      })
      throw Error(message)
    }
  } else {
    throw Error(
      `Uniqueness constraint broken: Multiple actions items targeting the same deployment found in queue (ActionStatus = queued). Something has gone wrong, please cleanup your 'Actions' table to continue`,
    )
  }
}

export default {
  action: async (
    { actionID }: { actionID: string },
    { logger, models }: IndexerManagementResolverContext,
  ): Promise<ActionResult | null> => {
    logger.debug(`Execute 'action' query`, {
      actionID,
    })
    return await models.Action.findOne({
      where: { id: actionID },
    })
  },

  actions: async (
    {
      filter,
      orderBy,
      orderDirection,
      first,
    }: {
      filter: ActionFilter
      orderBy: ActionParams
      orderDirection: OrderDirection
      first: number
    },
    { actionManager, logger }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    logger.debug(`Execute 'actions' query`, {
      filter,
      orderBy,
      orderDirection,
      first,
    })
    return await actionManager.fetchActions(filter, orderBy, orderDirection, first)
  },

  queueActions: async (
    { actions }: { actions: ActionInput[] },
    { actionManager, logger, networkMonitor, models }: IndexerManagementResolverContext,
  ): Promise<ActionResult[]> => {
    logger.debug(`Execute 'queueActions' mutation`, {
      actions,
    })

    await validateActionInputs(actions, actionManager, networkMonitor)

    const alreadyQueuedActions = await actionManager.fetchActions({
      status: ActionStatus.QUEUED,
    })
    const alreadyApprovedActions = await actionManager.fetchActions({
      status: ActionStatus.APPROVED,
    })

    const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
    const recentlyFailedActions = await actionManager.fetchActions({
      status: ActionStatus.FAILED,
      updatedAt: { [Op.gt]: yesterday },
    })

    const actionsAwaitingExecution = alreadyQueuedActions.concat(alreadyApprovedActions)

    let results: ActionResult[] = []

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await models.Action.sequelize!.transaction(async (transaction) => {
      for (const action of actions) {
        const result = await executeQueueOperation(
          logger,
          action,
          actionsAwaitingExecution,
          recentlyFailedActions,
          models,
          transaction,
        )
        results = results.concat(result)
      }
    })

    return results

    // Bulk insert alternative
    // return await models.Action.bulkCreate(actions, {
    //   validate: true,
    //   returning: true,
    // })
  },

  cancelActions: async (
    { actionIDs }: { actionIDs: number[] },
    { logger, models }: IndexerManagementResolverContext,
  ): Promise<ActionResult[]> => {
    logger.debug(`Execute 'cancelActions' mutation`, {
      actionIDs,
    })
    const [, canceledActions] = await models.Action.update(
      { status: ActionStatus.CANCELED },
      { where: { id: actionIDs }, returning: true },
    )

    if (canceledActions.length === 0) {
      throw Error(`Cancel action failed: No action items found with id in [${actionIDs}]`)
    }

    return canceledActions
  },

  deleteActions: async (
    { actionIDs }: { actionIDs: number[] },
    { logger, models }: IndexerManagementResolverContext,
  ): Promise<number> => {
    logger.debug(`Execute 'deleteActions' mutation`, {
      actionIDs,
    })
    const numDeleted = await models.Action.destroy({ where: { id: actionIDs } })

    if (numDeleted === 0) {
      throw Error(`Delete action failed: No action items found with id in [${actionIDs}]`)
    }

    return numDeleted
  },

  updateAction: async (
    { action }: { action: Action },
    { logger, models }: IndexerManagementResolverContext,
  ): Promise<ActionResult> => {
    logger.debug(`Execute 'updateAction' mutation`, {
      action,
    })
    const [, updatedActions] = await models.Action.update(action, {
      where: { id: action.id },
      returning: true,
    })

    if (updatedActions.length === 0) {
      throw Error(
        `Update action failed, are you sure there is an item in the queue with id = ${action.id}`,
      )
    }
    if (updatedActions.length > 1) {
      throw Error(
        `${updatedActions.length} action items updated in the queue. Should be '1'`,
      )
    }
    return updatedActions[0]
  },

  approveActions: async (
    { actionIDs }: { actionIDs: number[] },
    { logger, models }: IndexerManagementResolverContext,
  ): Promise<ActionResult[]> => {
    logger.debug(`Execute 'approveActions' mutation`, {
      actionIDs,
    })
    const [, updatedActions] = await models.Action.update(
      { status: ActionStatus.APPROVED },
      { where: { id: actionIDs }, returning: true },
    )

    if (updatedActions.length === 0) {
      throw Error(
        `Approve action failed: No action items found with id in [${actionIDs}]`,
      )
    }

    return updatedActions
  },

  executeApprovedActions: async (
    _: unknown,
    { logger, actionManager }: IndexerManagementResolverContext,
  ): Promise<ActionResult[]> => {
    logger.debug(`Execute 'executeApprovedActions' mutation`)
    return await actionManager.executeApprovedActions()
  },
}

// Helper function to assess equality among a enqueued and a proposed actions
function compareFailedActions(enqueued: Action, proposed: ActionInput): boolean {
  // actions are not the same if they target different deployments
  if (enqueued.deploymentID !== proposed.deploymentID) {
    return false
  }
  // actions are not the same if they have different types
  if (enqueued.type !== proposed.type) {
    return false
  }

  // Different fileds are used to assess equality depending on the action type
  const amount = enqueued.amount === proposed.amount
  const poi = enqueued.poi === proposed.poi
  const force = enqueued.force === proposed.force
  switch (proposed.type) {
    case ActionType.ALLOCATE:
      return amount
    case ActionType.UNALLOCATE:
      return poi && force
    case ActionType.REALLOCATE:
      return amount && poi && force
  }
}
