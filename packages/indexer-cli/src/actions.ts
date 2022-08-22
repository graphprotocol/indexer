import {
  ActionFilter,
  ActionInput,
  ActionParams,
  ActionResult,
  ActionStatus,
  ActionType,
  IndexerManagementClient,
  OrderDirection,
} from '@graphprotocol/indexer-common'
import { validateRequiredParams } from './command-helpers'
import gql from 'graphql-tag'
import { utils } from 'ethers'

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
  orderBy?: ActionParams,
  orderDirection?: OrderDirection,
): Promise<ActionResult[]> {
  const result = await client
    .query(
      gql`
        query actions(
          $filter: ActionFilter!
          $orderBy: ActionParams
          $orderDirection: OrderDirection
        ) {
          actions(filter: $filter, orderBy: $orderBy, orderDirection: $orderDirection) {
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
      { filter: actionFilter, orderBy, orderDirection },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.actions
}
