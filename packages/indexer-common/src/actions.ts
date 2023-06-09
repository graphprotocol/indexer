import { ActionManager, NetworkMonitor } from './indexer-management'
import { AllocationStatus } from './allocations'
import { WhereOperators, WhereOptions } from 'sequelize'
import { Op } from 'sequelize'
import { WhereAttributeHashValue } from 'sequelize/types/model'

export interface ActionParamsInput {
  deploymentID?: string
  allocationID?: string
  amount?: string
  poi?: string
  force?: boolean
}

export interface ActionItem {
  params: ActionParamsInput
  type: ActionType
  reason: string
  status?: ActionStatus
  protocolNetwork: string
}

export interface ActionUpdateInput {
  deploymentID?: string
  allocationID?: string
  amount?: string
  poi?: string
  force?: boolean
  type?: ActionType
  status?: ActionStatus
  reason?: string
  protocolNetwork?: string
}

export interface ActionInput {
  type: ActionType
  deploymentID: string
  allocationID?: string
  amount?: string
  poi?: string
  force?: boolean
  source: string
  reason: string
  status: ActionStatus
  priority: number | undefined
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
    case ActionType.ALLOCATE:
      hasActionParams = 'deploymentID' in variableToCheck && 'amount' in variableToCheck
      break
    case ActionType.UNALLOCATE:
      hasActionParams =
        'deploymentID' in variableToCheck && 'allocationID' in variableToCheck
      break
    case ActionType.REALLOCATE:
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
): Promise<void> => {
  // Validate actions before adding to queue
  // TODO: Perform all checks simultaneously and throw combined error if 1 or more fail
  for (const action of actions) {
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
      [
        ActionStatus.FAILED,
        ActionStatus.SUCCESS,
        ActionStatus.PENDING,
        ActionStatus.CANCELED,
      ].includes(action.status)
    ) {
      throw Error(
        `Cannot queue action with status ${action.status}, must be one of ['APPROVED', 'QUEUED']`,
      )
    }

    // Action must target an existing subgraph deployment
    const subgraphDeployment = await networkMonitor.subgraphDeployment(
      action.deploymentID,
    )
    if (!subgraphDeployment) {
      throw new Error(
        `No subgraphDeployment with ipfsHash = '${action.deploymentID}' found on the network`,
      )
    }

    // Unallocate & reallocate actions must target an active allocationID
    if ([ActionType.UNALLOCATE, ActionType.REALLOCATE].includes(action.type)) {
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

export interface ActionFilter {
  id?: number | undefined
  type?: ActionType
  status?: ActionStatus
  source?: string
  reason?: string
  updatedAt?: WhereOperators
  protocolNetwork?: string
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

export enum ActionType {
  ALLOCATE = 'allocate',
  UNALLOCATE = 'unallocate',
  REALLOCATE = 'reallocate',
}

export enum ActionStatus {
  QUEUED = 'queued',
  APPROVED = 'approved',
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export enum ActionParams {
  ID = 'id',
  STATUS = 'status',
  TYPE = 'type',
  DEPLOYMENT_ID = 'deploymentID',
  ALLOCATION_ID = 'allocationID',
  TRANSACTION = 'transaction',
  AMOUNT = 'amount',
  POI = 'poi',
  FORCE = 'force',
  SOURCE = 'source',
  REASON = 'reason',
  PRIORITY = 'priority',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  PROTOCOL_NETWORK = 'protocolNetwork',
}
