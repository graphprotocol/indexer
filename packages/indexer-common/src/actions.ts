import { NetworkMonitor } from './indexer-management'
import { AllocationStatus } from './allocations'
import { Logger } from '@graphprotocol/common-ts'
import { WhereOptions } from 'sequelize'
import { Op } from 'sequelize'
import { WhereAttributeHashValue } from 'sequelize/types/model'
import { validateNetworkIdentifier } from './parsers'
import {
  ActionFilter,
  ActionUpdateInput,
  ActionParams,
  ActionInput,
  ActionType,
  ActionStatus,
} from './schema/types.generated'

export { ActionUpdateInput, ActionParams }

export interface ActionItem {
  params: ActionUpdateInput
  type: ActionType
  reason: string
  status?: ActionStatus
  protocolNetwork: string
}

export const isValidActionInput = (
  /* eslint-disable @typescript-eslint/no-explicit-any */
  variableToCheck: any,
): variableToCheck is ActionInput => {
  if (!('type' in variableToCheck)) {
    return false
  }
  let hasActionParams = false
  switch (variableToCheck.type) {
    case ActionType.allocate:
      hasActionParams = 'deploymentID' in variableToCheck && 'amount' in variableToCheck
      break
    case ActionType.unallocate:
      hasActionParams =
        'deploymentID' in variableToCheck && 'allocationID' in variableToCheck
      break
    case ActionType.reallocate:
      hasActionParams =
        'deploymentID' in variableToCheck &&
        'allocationID' in variableToCheck &&
        'amount' in variableToCheck
  }
  return (
    hasActionParams &&
    'source' in variableToCheck &&
    'reason' in variableToCheck &&
    'status' in variableToCheck &&
    'priority' in variableToCheck
  )
}

export const validateActionInputs = async (
  actions: ActionInput[],
  networkMonitor: NetworkMonitor,
  logger: Logger,
): Promise<void> => {
  // Validate actions before adding to queue
  // TODO: Perform all checks simultaneously and throw combined error if 1 or more fail
  for (const action of actions) {
    // Must have a valid protocol network identifier
    if (!action.protocolNetwork) {
      throw Error("Cannot set an action without the field 'protocolNetwork'")
    }

    try {
      // Set the parsed network identifier back in the action input object
      action.protocolNetwork = validateNetworkIdentifier(action.protocolNetwork)
    } catch (e) {
      throw Error(`Invalid value for the field 'protocolNetwork'. ${e}`)
    }

    // Must have the required params for the action type
    if (!isValidActionInput(action)) {
      throw new Error(
        `Failed to queue action: Invalid action input, actionInput: ${JSON.stringify(
          action,
        )}`,
      )
    }

    // Must have status QUEUED or APPROVED
    if (
      action.status === 'failed' ||
      action.status === 'success' ||
      action.status === 'pending' ||
      action.status === 'canceled'
    ) {
      throw Error(
        `Cannot queue action with status ${action.status}, must be one of ['APPROVED', 'QUEUED']`,
      )
    }

    // Action must target an existing subgraph deployment
    const subgraphDeployment = await networkMonitor.subgraphDeployment(
      // @ts-expect-error - deploymentID should be here
      action.deploymentID,
    )
    if (!subgraphDeployment) {
      logger.warn(
        `No subgraphDeployment with ipfsHash = '${action.deploymentID}' found on the network`,
      )
    }

    // Unallocate & reallocate actions must target an active allocationID
    if (action.type === 'unallocate' || action.type === 'reallocate') {
      // allocationID must belong to active allocation
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const allocation = await networkMonitor.allocation(action.allocationID!)
      if (allocation.status !== AllocationStatus.ACTIVE) {
        throw new Error(
          `An active allocation does not exist with id = '${action.allocationID}'`,
        )
      }

      // Provided allocationIDs must be associated with the provided deploymentIDs
      if (allocation.subgraphDeployment.id.ipfsHash !== action.deploymentID) {
        throw new Error(
          `Allocation specified (${action.allocationID}) is not associated with the deployment specified (${action.deploymentID})`,
        )
      }
    }
  }
}

export const actionFilterToWhereOptions = (filter: ActionFilter): WhereOptions => {
  const whereOptions = [] as WhereAttributeHashValue<any>[]

  Object.entries(filter).forEach(([key, value]) => {
    if (value) {
      const obj: { [key: string]: any } = {}
      obj[key] = value
      whereOptions.push(obj)
    }
  })

  return whereOptions.length == 0 ? {} : { [Op.and]: whereOptions }
}

export interface ActionResult {
  id: number
  type: ActionType
  deploymentID: string
  allocationID: string | null
  amount: string | null
  poi: string | null
  force: boolean | null
  source: string
  reason: string
  status: ActionStatus
  priority: number | undefined
  failureReason: string | null
  transaction: string | null
  protocolNetwork: string
}
