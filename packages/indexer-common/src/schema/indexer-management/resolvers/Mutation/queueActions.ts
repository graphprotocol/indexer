import { validateNetworkIdentifier } from 'indexer-common/src/parsers/validators'
import type {
  Action,
  ActionInput,
  ActionResult,
  MutationResolvers,
} from './../../../types.generated'
import groupBy from 'lodash.groupby'
import {
  ActionStatus,
  ActionType,
  validateActionInputs,
} from 'indexer-common/src/actions'
import { ActionManager } from 'indexer-common/src/indexer-management/actions'
import { Op, Transaction, literal } from 'sequelize'
import { Logger } from '@graphprotocol/common-ts'
import { IndexerManagementModels } from '@graphprotocol/indexer-common'

/* Helper function to assess equality among a enqueued and a proposed actions */
function compareActions(enqueued: Action, proposed: ActionInput): boolean {
  // actions are not the same if they target different protocol networks
  if (enqueued.protocolNetwork !== proposed.protocolNetwork) {
    return false
  }

  // actions are not the same if they target different deployments
  if (enqueued.deploymentID !== proposed.deploymentID) {
    return false
  }
  // actions are not the same if they have different types
  if (enqueued.type !== proposed.type) {
    return false
  }

  // Different fields are used to assess equality depending on the action type
  const amount = enqueued.amount === proposed.amount
  const poi = enqueued.poi == proposed.poi
  const force = enqueued.force == proposed.force
  switch (proposed.type) {
    case ActionType.ALLOCATE:
      return amount
    case ActionType.UNALLOCATE:
      return poi && force
    case ActionType.REALLOCATE:
      return amount && poi && force
    default:
      return false
  }
}

// Perform insert, update, or no-op depending on existing queue data
// INSERT - No item in the queue yet targeting this deploymentID
// UPDATE - Already an item in the queue targeting the same deploymentID AND that item was added by the same 'source'
// NO-OP - Already an item in the queue targeting the same deploymentID BUT was added by a different source
// TODO: Use pending status for actions in process of execution, detect here and if duplicate pending found, NOOP
async function executeQueueOperation(
  logger: Logger,
  action: ActionInput,
  actionsAwaitingExecution: Action[],
  recentlyAttemptedActions: Action[],
  models: IndexerManagementModels,
  transaction: Transaction,
) {
  // Check for previously failed conflicting actions
  const conflictingActions = recentlyAttemptedActions.filter(function (recentAction) {
    const areEqual = compareActions(recentAction, action)
    const fromAgent = action.source === 'indexerAgent'
    return areEqual && fromAgent
  })
  if (conflictingActions.length > 0) {
    const message = `Recently executed '${action.type}' action found in queue targeting '${action.deploymentID}', ignoring.`
    logger.warn(message, {
      recentlyAttemptedAction: conflictingActions,
      proposedAction: action,
    })
    throw Error(message)
  }

  // Check for duplicated actions
  const duplicateActions = actionsAwaitingExecution.filter(
    (a) =>
      a.deploymentID === action.deploymentID &&
      a.protocolNetwork === action.protocolNetwork,
  )
  if (duplicateActions.length === 0) {
    logger.trace('Inserting Action in database', { action })
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
      logger.trace(
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

export const queueActions: NonNullable<MutationResolvers['queueActions']> = async (
  _parent,
  { actions },
  { logger, models, actionManager, multiNetworks },
) => {
  logger.debug(`Execute 'queueActions' mutation`, {
    actions,
  })

  if (!actionManager || !multiNetworks) {
    throw Error('IndexerManagementClient must be in `network` mode to modify actions')
  }

  // Sanitize protocol network identifier
  actions.forEach((action) => {
    try {
      action.protocolNetwork = validateNetworkIdentifier(action.protocolNetwork)
    } catch (e) {
      throw Error(`Invalid value for the field 'protocolNetwork'. ${e}`)
    }
  })

  // Let Network Monitors validate actions based on their protocol networks
  await multiNetworks.mapNetworkMapped(
    groupBy(actions, (action) => action.protocolNetwork),
    (network, actions) => validateActionInputs(actions, network.networkMonitor, logger),
  )

  const alreadyQueuedActions = await ActionManager.fetchActions(
    models,
    {
      status: ActionStatus.QUEUED,
    },
    null,
  )
  const alreadyApprovedActions = await ActionManager.fetchActions(
    models,
    {
      status: ActionStatus.APPROVED,
    },
    null,
  )
  const actionsAwaitingExecution = alreadyQueuedActions.concat(alreadyApprovedActions)

  // Fetch recently attempted actions
  const last15Minutes = {
    [Op.gte]: literal("NOW() - INTERVAL '15m'"),
  }

  const recentlyFailedActions = await ActionManager.fetchActions(
    models,
    {
      status: ActionStatus.FAILED,
      updatedAt: last15Minutes,
    },
    null,
  )

  const recentlySuccessfulActions = await ActionManager.fetchActions(
    models,
    {
      status: ActionStatus.SUCCESS,
      updatedAt: last15Minutes,
    },
    null,
  )

  logger.trace('Recently attempted actions', {
    recentlySuccessfulActions,
    recentlyFailedActions,
  })

  const recentlyAttemptedActions = recentlyFailedActions.concat(recentlySuccessfulActions)

  let results: ActionResult[] = []

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  await models.Action.sequelize!.transaction(async (transaction) => {
    for (const action of actions) {
      const result = await executeQueueOperation(
        logger,
        action,
        actionsAwaitingExecution,
        recentlyAttemptedActions,
        models,
        transaction,
      )
      results = results.concat(result)
    }
  })

  return results
}
