import { NetworkMonitor } from './indexer-management'
import { AllocationStatus } from './allocations'
import { Logger } from '@graphprotocol/common-ts'
import { WhereOperators, WhereOptions } from 'sequelize'
import { Op } from 'sequelize'
import { WhereAttributeHashValue } from 'sequelize/types/model'
import { validateNetworkIdentifier } from './parsers'

export interface ActionParamsInput {
  deploymentID?: string
  allocationID?: string
  amount?: string
  poi?: string
  publicPOI?: string
  poiBlockNumber?: number
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
  publicPOI?: string
  poiBlockNumber?: number
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
  publicPOI?: string
  poiBlockNumber?: number
  force?: boolean
  source: string
  reason: string
  status: ActionStatus
  priority: number | undefined
  protocolNetwork: string
}

const ZERO_POI = '0x0000000000000000000000000000000000000000000000000000000000000000'

// Zero POI is a sentinel for "no POI to submit", so publicPOI and poiBlockNumber
// are optional then (and when POI is omitted); a real POI requires both.
/* eslint-disable @typescript-eslint/no-explicit-any */
const hasValidPOIParams = (variableToCheck: any): boolean => {
  if (variableToCheck.poi === undefined || variableToCheck.poi === ZERO_POI) {
    return true
  }
  return 'publicPOI' in variableToCheck && 'poiBlockNumber' in variableToCheck
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
        'deploymentID' in variableToCheck &&
        'allocationID' in variableToCheck &&
        hasValidPOIParams(variableToCheck)
      break
    case ActionType.RESIZE:
      hasActionParams =
        'deploymentID' in variableToCheck &&
        'allocationID' in variableToCheck &&
        'amount' in variableToCheck
      break
    case ActionType.PRESENT_POI:
      hasActionParams =
        'deploymentID' in variableToCheck &&
        'allocationID' in variableToCheck &&
        hasValidPOIParams(variableToCheck)
      break
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

    // Must have status QUEUED or APPROVED, or DEPLOYING
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
      logger.warn(
        `No subgraphDeployment with ipfsHash = '${action.deploymentID}' found on the network`,
      )
    }

    // Unallocate, resize, and presentPOI actions must target an active allocationID
    if (
      [ActionType.UNALLOCATE, ActionType.RESIZE, ActionType.PRESENT_POI].includes(
        action.type,
      )
    ) {
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

      // Block closing an allocation that still owes DIPS fees: SubgraphService.collect
      // requires the allocation open, so an early close would cancel a live agreement
      // on-chain or strand fees a canceled agreement hasn't finished collecting.
      if (action.type === ActionType.UNALLOCATE && action.allocationID) {
        const hasAgreement = await networkMonitor.hasCollectableDipsAgreement(
          action.allocationID,
        )
        if (hasAgreement && !action.force) {
          throw new Error(
            `Allocation ${action.allocationID} has a DIPS agreement that can still collect fees. ` +
              `Closing it now would cancel a live agreement on-chain, or strand fees that a ` +
              `canceled agreement has not finished collecting. Use force=true to proceed anyway.`,
          )
        }
        if (hasAgreement && action.force) {
          logger.warn('Force-closing allocation with a collectable DIPS agreement', {
            allocationId: action.allocationID,
            actionType: action.type,
          })
        }
      }
    }
  }
}

export interface ActionFilter {
  id?: number | undefined
  type?: ActionType
  status?: ActionStatus | ActionStatus[]
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
  publicPOI: string | null
  poiBlockNumber: number | null
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
  PRESENT_POI = 'presentPOI',
  RESIZE = 'resize',
}

// Rewards accrue per block, so a present-POI mid-epoch collects only what accrued
// since the last and mostly wastes gas; one per epoch suffices. We record the epoch
// in the action `reason` so the agent can skip allocations already harvested this epoch.
const PRESENT_POI_REASON_PREFIX = 'presentPOI:staleness-prevention'

export function presentPOIReason(epoch: number): string {
  return `${PRESENT_POI_REASON_PREFIX}:epoch=${epoch}`
}

// Returns the epoch encoded in a present-POI action `reason`, or undefined if
// the reason carries no epoch (e.g. an action queued before this field existed).
export function presentPOIReasonEpoch(reason: string | null): number | undefined {
  const match = reason?.match(/:epoch=(\d+)$/)
  return match ? Number(match[1]) : undefined
}

export enum ActionStatus {
  QUEUED = 'queued',
  APPROVED = 'approved',
  PENDING = 'pending',
  DEPLOYING = 'deploying',
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
  PUBLIC_POI = 'publicPOI',
  POI_BLOCK_NUMBER = 'poiBlockNumber',
  FORCE = 'force',
  SOURCE = 'source',
  REASON = 'reason',
  PRIORITY = 'priority',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  PROTOCOL_NETWORK = 'protocolNetwork',
}
