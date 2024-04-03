import {
  ActionParams,
  ActionResult,
  ActionUpdateInput,
  GeneratedGraphQLTypes,
  nullPassThrough,
  OrderDirection,
  parseBoolean,
} from '@graphprotocol/indexer-common'
import { validatePOI, validateRequiredParams } from './command-helpers'
import gql from 'graphql-tag'
import { utils } from 'ethers'
import { parseGRT } from '@graphprotocol/common-ts'
import { Client } from '@urql/core'

export interface GenericActionInputParams {
  targetDeployment: string
  param1: string | undefined
  param2: string | undefined
  param3: string | undefined
  param4: string | undefined
}

// Make separate functions for each action type parsing from generic?
export async function buildActionInput(
  type: GeneratedGraphQLTypes.ActionType,
  actionParams: GenericActionInputParams,
  source: string,
  reason: string,
  status: GeneratedGraphQLTypes.ActionStatus,
  priority: number,
  protocolNetwork: string,
): Promise<GeneratedGraphQLTypes.ActionInput> {
  await validateActionInput(type, actionParams)
  switch (type) {
    case 'allocate':
      return {
        deploymentID: actionParams.targetDeployment,
        amount: actionParams.param1?.toString(),
        type,
        source,
        reason,
        status,
        priority,
        protocolNetwork,
      }
    case 'unallocate': {
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
        protocolNetwork,
      }
    }
    case 'reallocate': {
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
        protocolNetwork,
      }
    }
  }
}

export async function validateActionInput(
  type: GeneratedGraphQLTypes.ActionType,
  actionParams: GenericActionInputParams,
): Promise<void> {
  let requiredFields: string[] = []
  switch (type) {
    case 'allocate':
      requiredFields = requiredFields.concat(['targetDeployment', 'param1'])
      break
    case 'unallocate':
      requiredFields = requiredFields.concat(['targetDeployment', 'param1'])
      break
    case 'reallocate':
      requiredFields = requiredFields.concat(['targetDeployment', 'param1', 'param2'])
  }

  return await validateRequiredParams(
    { ...actionParams } as Record<string, unknown>,
    requiredFields,
  )
}

export function validateActionType(input: string): GeneratedGraphQLTypes.ActionType {
  const validVariants = Object.keys(GeneratedGraphQLTypes.ActionType).map(variant =>
    variant.toLowerCase(),
  )
  if (!validVariants.includes(input.toLowerCase())) {
    throw Error(
      `Invalid 'ActionType' "${input}", must be one of ['${validVariants.join(`', '`)}']`,
    )
  }
  return GeneratedGraphQLTypes.ActionType[
    input.toLowerCase() as keyof typeof GeneratedGraphQLTypes.ActionType
  ]
}

export function validateActionStatus(input: string): GeneratedGraphQLTypes.ActionStatus {
  const validVariants = Object.keys(GeneratedGraphQLTypes.ActionStatus).map(variant =>
    variant.toLowerCase(),
  )
  if (!validVariants.includes(input.toLowerCase())) {
    throw Error(
      `Invalid 'ActionStatus' "${input}", must be one of ['${validVariants.join(
        `', '`,
      )}']`,
    )
  }
  return GeneratedGraphQLTypes.ActionStatus[
    input.toUpperCase() as keyof typeof GeneratedGraphQLTypes.ActionStatus
  ]
}

export function buildActionFilter(
  id: string | undefined,
  type: string | undefined,
  status: string | undefined,
  source: string | undefined,
  reason: string | undefined,
): GeneratedGraphQLTypes.ActionFilter {
  const filter: GeneratedGraphQLTypes.ActionFilter = {}
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
  client: Client,
  actions: GeneratedGraphQLTypes.ActionInput[],
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
            protocolNetwork
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

const ACTION_PARAMS_PARSERS: Record<
  keyof GeneratedGraphQLTypes.ActionUpdateInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  deploymentID: x => nullPassThrough(x),
  allocationID: x => x,
  amount: nullPassThrough(parseGRT),
  poi: nullPassThrough((x: string) => validatePOI(x)),
  force: x => parseBoolean(x),
  type: x => validateActionType(x),
  status: x => validateActionStatus(x),
  reason: nullPassThrough,
  id: x => nullPassThrough(x),
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

export async function executeApprovedActions(client: Client): Promise<ActionResult[]> {
  const result = await client
    .mutation(gql`
      mutation executeApprovedActions {
        executeApprovedActions {
          id
          protocolNetwork
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
    `)
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.executeApprovedActions
}

export async function approveActions(
  client: Client,
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
            protocolNetwork
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
  client: Client,
  actionIDs: number[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation cancelActions($actionIDs: [Int!]!) {
          cancelActions(actionIDs: $actionIDs) {
            id
            protocolNetwork
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
  client: Client,
  actionID: number,
): Promise<ActionResult> {
  const result = await client
    .query(
      gql`
        query action($actionID: Int!) {
          action(actionID: $actionID) {
            id
            protocolNetwork
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
  client: Client,
  actionFilter: GeneratedGraphQLTypes.ActionFilter,
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
            protocolNetwork
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
  client: Client,
  actionIDs: number[],
): Promise<ActionResult[]> {
  const result = await client
    .mutation(
      gql`
        mutation deleteActions($actionIDs: [Int!]!) {
          deleteActions(actionIDs: $actionIDs) {
            id
            protocolNetwork
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
  client: Client,
  filter: GeneratedGraphQLTypes.ActionFilter,
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
            protocolNetwork
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
