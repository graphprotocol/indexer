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
  validateNetworkIdentifier,
} from '@graphprotocol/indexer-common'
import { validatePOI, validateRequiredParams } from './command-helpers'
import gql from 'graphql-tag'
import { hexlify } from 'ethers'
import { formatGRT, parseGRT } from '@graphprotocol/common-ts'

export interface GenericActionInputParams {
  targetDeployment: string
  param1: string | undefined
  param2: string | undefined
  param3: string | undefined
  param4: string | undefined
  param5: string | undefined
  param6: string | undefined
}

interface NormalizedPOIParams {
  poi: string | undefined
  publicPOI: string | undefined
  poiBlockNumber: number | undefined
}

/**
 * Normalizes POI-related parameters for action inputs.
 * Converts '0' or '0x0' to proper zero-filled bytes and parses block number.
 */
function normalizePOIParams(
  poi: string | undefined,
  publicPOI: string | undefined,
  blockNumber: string | undefined,
): NormalizedPOIParams {
  const zeroPOI = hexlify(new Uint8Array(32).fill(0))

  let normalizedPoi = poi
  if (normalizedPoi === '0' || normalizedPoi === '0x0') {
    normalizedPoi = zeroPOI
  }

  let normalizedPublicPoi = publicPOI
  if (normalizedPublicPoi === '0' || normalizedPublicPoi === '0x0') {
    normalizedPublicPoi = zeroPOI
  }

  const poiBlockNumber = blockNumber !== undefined ? Number(blockNumber) : undefined

  return {
    poi: normalizedPoi,
    publicPOI: normalizedPublicPoi,
    poiBlockNumber,
  }
}

// Make separate functions for each action type parsing from generic?
export async function buildActionInput(
  type: ActionType,
  actionParams: GenericActionInputParams,
  source: string,
  reason: string,
  status: ActionStatus,
  priority: number,
  protocolNetwork: string,
): Promise<ActionInput> {
  await validateActionInput(type, actionParams)

  // TODO HORIZON: we could check isHorizon status here to set the proper value for isLegacy, but it requires multiNetworks
  // The IndexerManagementServer will set the correct value anyways
  const isLegacy = false

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
        protocolNetwork,
        isLegacy,
      }
    case ActionType.UNALLOCATE: {
      const { poi, publicPOI, poiBlockNumber } = normalizePOIParams(
        actionParams.param2,
        actionParams.param5,
        actionParams.param4,
      )
      return {
        deploymentID: actionParams.targetDeployment,
        allocationID: actionParams.param1,
        poi,
        publicPOI,
        poiBlockNumber,
        force: actionParams.param3 === 'true',
        type,
        source,
        reason,
        status,
        priority,
        protocolNetwork,
        isLegacy,
      }
    }
    case ActionType.REALLOCATE: {
      const { poi, publicPOI, poiBlockNumber } = normalizePOIParams(
        actionParams.param3,
        actionParams.param6,
        actionParams.param5,
      )
      return {
        deploymentID: actionParams.targetDeployment,
        allocationID: actionParams.param1,
        amount: actionParams.param2?.toString(),
        poi,
        publicPOI,
        poiBlockNumber,
        force: actionParams.param4 === 'true',
        type,
        source,
        reason,
        status,
        priority,
        protocolNetwork,
        isLegacy,
      }
    }
    case ActionType.COLLECT: {
      // collect <deploymentID> <allocationID> <poi> <force> <blockNumber> <publicPOI>
      const { poi, publicPOI, poiBlockNumber } = normalizePOIParams(
        actionParams.param2,
        actionParams.param5,
        actionParams.param4,
      )
      return {
        deploymentID: actionParams.targetDeployment,
        allocationID: actionParams.param1,
        poi,
        publicPOI,
        poiBlockNumber,
        force: actionParams.param3 === 'true',
        type,
        source,
        reason,
        status,
        priority,
        protocolNetwork,
        isLegacy,
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
      break
    case ActionType.COLLECT:
      requiredFields = requiredFields.concat(['targetDeployment', 'param1'])
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
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            status
            protocolNetwork
            isLegacy
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
  publicPOI: nullPassThrough((x: string) => validatePOI(x)),
  poiBlockNumber: nullPassThrough((x: string) => Number(x)),
  force: x => parseBoolean(x),
  type: x => validateActionType(x),
  status: x => validateActionStatus(x),
  reason: nullPassThrough,
  protocolNetwork: x => validateNetworkIdentifier(x),
  isLegacy: x => parseBoolean(x),
}

const ACTION_CONVERTERS_TO_GRAPHQL: Record<
  keyof ActionUpdateInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  deploymentID: x => x,
  allocationID: x => x,
  amount: nullPassThrough((x: bigint) => formatGRT(x)),
  poi: x => x,
  publicPOI: x => x,
  poiBlockNumber: nullPassThrough((x: number) => x),
  force: x => x,
  type: x => x,
  status: x => x,
  reason: x => x,
  protocolNetwork: x => x,
  isLegacy: x => x,
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

/**
 * Converts a normalized action to a representation
 * compatible with the indexer management GraphQL API.
 */
export const actionToGraphQL = (
  action: Partial<ActionUpdateInput>,
): Partial<ActionUpdateInput> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(action)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (ACTION_CONVERTERS_TO_GRAPHQL as any)[key](value)
  }
  return obj as Partial<ActionUpdateInput>
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
            protocolNetwork
            status
            type
            deploymentID
            allocationID
            amount
            poi
            publicPOI
            poiBlockNumber
            force
            source
            reason
            transaction
            failureReason
            isLegacy
          }
        }
      `,
      undefined,
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
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            protocolNetwork
            isLegacy
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
            protocolNetwork
            type
            allocationID
            deploymentID
            amount
            poi
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            isLegacy
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
            protocolNetwork
            type
            allocationID
            deploymentID
            amount
            poi
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            isLegacy
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
            protocolNetwork
            type
            allocationID
            deploymentID
            amount
            poi
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            failureReason
            isLegacy
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
            protocolNetwork
            type
            allocationID
            deploymentID
            amount
            poi
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            failureReason
            isLegacy
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
            publicPOI
            poiBlockNumber
            force
            source
            reason
            priority
            transaction
            status
            failureReason
            protocolNetwork
            isLegacy
          }
        }
      `,
      { filter, action: actionToGraphQL(action) },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.updateActions
}
