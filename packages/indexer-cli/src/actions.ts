import {
  ActionFilter,
  ActionInput,
  ActionParams,
  ActionResult,
  ActionStatus,
  ActionType,
  ActionUpdateInput,
  IndexerManagementClient,
  nullPassThrough,
  OrderDirection,
  parseBoolean,
} from '@graphprotocol/indexer-common'
import { validatePOI, validateRequiredParams } from './command-helpers'
import gql from 'graphql-tag'
import { utils } from 'ethers'
import { parseGRT } from '@tokene-q/common-ts'

export interface GenericActionInputParams {
  targetDeployment: string
  param1: string | undefined
  param2: string | undefined
  param3: string | undefined
  param4: string | undefined
}

// Make separate functions for each action type parsing from generic?
export async function buildActionInput(
  type: ActionType,
  actionParams: GenericActionInputParams,
  source: string,
  reason: string,
  status: ActionStatus,
  priority: number,
): Promise<ActionInput> {
  await validateActionInput(type, actionParams)
  switch (type) {
    case ActionType.ALLOCATE:
      return {
        deploymentID: actionParams.targetDeployment,
        amount: actionParams.param1?.toString(),
        type,
        source,
        reason,
        status,
        priority,
      }
    case ActionType.UNALLOCATE: {
      let poi = actionParams.param2
      if (poi == '0' || poi == '0x0') {
        poi = utils.hexlify(Array(32).fill(0))
      }
      return {
        deploymentID: actionParams.targetDeployment,
        allocationID: actionParams.param1,
        poi: poi,
        force: actionParams.param3 === 'true',
        type,
        source,
        reason,
        status,
        priority,
      }
    }
    case ActionType.REALLOCATE: {
      let poi = actionParams.param3
      if (poi == '0' || poi == '0x0') {
        poi = utils.hexlify(Array(32).fill(0))
      }
      return {
        deploymentID: actionParams.targetDeployment,
        allocationID: actionParams.param1,
        amount: actionParams.param2?.toString(),
        poi: poi,
        force: actionParams.param4 === 'true',
        type,
        source,
        reason,
        status,
        priority,
      }
    }
  }
}

export async function validateActionInput(
  type: ActionType,
  actionParams: GenericActionInputParams,
): Promise<void> {
  let requiredFields: string[] = []
  switch (type) {
    case ActionType.ALLOCATE:
      requiredFields = requiredFields.concat(['targetDeployment', 'param1'])
      break
    case ActionType.UNALLOCATE:
      requiredFields = requiredFields.concat(['targetDeployment', 'param1'])
      break
    case ActionType.REALLOCATE:
      requiredFields = requiredFields.concat(['targetDeployment', 'param1', 'param2'])
  }

  return await validateRequiredParams(
    { ...actionParams } as Record<string, unknown>,
    requiredFields,
  )
}

export function validateActionType(input: string): ActionType {
  const validVariants = Object.keys(ActionType).map(variant =>
    variant.toLocaleLowerCase(),
  )
  if (!validVariants.includes(input.toLocaleLowerCase())) {
    throw Error(
      `Invalid 'ActionType' "${input}", must be one of ['${validVariants.join(`', '`)}']`,
    )
  }
  return ActionType[input.toUpperCase() as keyof typeof ActionType]
}

export function validateActionStatus(input: string): ActionStatus {
  const validVariants = Object.keys(ActionStatus).map(variant =>
    variant.toLocaleLowerCase(),
  )
  if (!validVariants.includes(input.toLocaleLowerCase())) {
    throw Error(
      `Invalid 'ActionStatus' "${input}", must be one of ['${validVariants.join(
        `', '`,
      )}']`,
    )
  }
  return ActionStatus[input.toUpperCase() as keyof typeof ActionStatus]
}

export function buildActionFilter(
  id: string | undefined,
  type: string | undefined,
  status: string | undefined,
  source: string | undefined,
  reason: string | undefined,
): ActionFilter {
  const filter: ActionFilter = {}
  if (id) {
    filter.id = +id
  }
  if (type) {
    filter.type = validateActionType(type)
  }
  if (status) {
    filter.status = validateActionStatus(status)
  }
  if (source) {
    filter.source = source
  }
  if (reason) {
    filter.reason = reason
  }
  if (Object.keys(filter).length === 0) {
    throw Error(
      `No action filter provided, please specify at least one filter using ['--id', '--type', '--status', '--source', '--reason']`,
    )
  }
  return filter
}

export async function queueActions(
  client: IndexerManagementClient,
  actions: ActionInput[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation queueActions($actions: [ActionInput!]!) {
          queueActions(actions: $actions) {
            id
            type
            deploymentID
            allocationID
            amount
            poi
            force
            source
            reason
            priority
            status
          }
        }
      `,
      { actions },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.queueActions
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACTION_PARAMS_PARSERS: Record<keyof ActionUpdateInput, (x: never) => any> = {
  deploymentID: x => nullPassThrough(x),
  allocationID: x => x,
  amount: nullPassThrough(parseGRT),
  poi: nullPassThrough((x: string) => validatePOI(x)),
  force: x => parseBoolean(x),
  type: x => validateActionType(x),
  status: x => validateActionStatus(x),
  reason: nullPassThrough,
}

/**
 * Parses a user-provided action update input into a normalized form.
 */
export const parseActionUpdateInput = (input: object): ActionUpdateInput => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(input)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj[key] = (ACTION_PARAMS_PARSERS as any)[key](value)
    } catch (error) {
      throw new Error(`Failed to parse value for key, ${key}: ${error}`)
    }
  }
  return obj as ActionUpdateInput
}

export async function executeApprovedActions(
  client: IndexerManagementClient,
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation executeApprovedActions {
          executeApprovedActions {
            id
            status
            type
            deploymentID
            allocationID
            amount
            poi
            force
            source
            reason
            transaction
            failureReason
          }
        }
      `,
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.executeApprovedActions
}

export async function approveActions(
  client: IndexerManagementClient,
  actionIDs: number[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation approveActions($actionIDs: [Int!]!) {
          approveActions(actionIDs: $actionIDs) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
          }
        }
      `,
      { actionIDs },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.approveActions
}

export async function cancelActions(
  client: IndexerManagementClient,
  actionIDs: number[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation cancelActions($actionIDs: [Int!]!) {
          cancelActions(actionIDs: $actionIDs) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
          }
        }
      `,
      { actionIDs },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.cancelActions
}

export async function fetchAction(
  client: IndexerManagementClient,
  actionID: number,
): Promise<ActionResult> {
  const result = await client
    .query(
      gql`
        query action($actionID: Int!) {
          action(actionID: $actionID) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
          }
        }
      `,
      { actionID },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.action
}

export async function fetchActions(
  client: IndexerManagementClient,
  actionFilter: ActionFilter,
  first?: number,
  orderBy?: ActionParams,
  orderDirection?: OrderDirection,
): Promise<ActionResult[]> {
  const result = await client
    .query(
      gql`
        query actions(
          $filter: ActionFilter!
          $first: Int
          $orderBy: ActionParams
          $orderDirection: OrderDirection
        ) {
          actions(
            filter: $filter
            orderBy: $orderBy
            orderDirection: $orderDirection
            first: $first
          ) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
            failureReason
          }
        }
      `,
      { filter: actionFilter, orderBy, orderDirection, first },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.actions
}

export async function deleteActions(
  client: IndexerManagementClient,
  actionIDs: number[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation deleteActions($actionIDs: [Int!]!) {
          deleteActions(actionIDs: $actionIDs) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
            failureReason
          }
        }
      `,
      { actionIDs },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.deleteActions
}

export async function updateActions(
  client: IndexerManagementClient,
  filter: ActionFilter,
  action: ActionUpdateInput,
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation updateActions($filter: ActionFilter!, $action: ActionUpdateInput!) {
          updateActions(filter: $filter, action: $action) {
            id
            type
            allocationID
            deploymentID
            amount
            poi
            force
            source
            reason
            priority
            transaction
            status
            failureReason
          }
        }
      `,
      { filter, action },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.updateActions
}
