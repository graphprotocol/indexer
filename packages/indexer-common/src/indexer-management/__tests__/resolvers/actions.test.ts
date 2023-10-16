/* eslint-disable @typescript-eslint/no-explicit-any */

import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import {
  connectDatabase,
  createLogger,
  Logger,
  Metrics,
  createMetrics,
} from '@graphprotocol/common-ts'

import { IndexerManagementClient } from '../../client'
import {
  Action,
  defineIndexerManagementModels,
  IndexerManagementModels,
} from '../../models'
import {
  ActionInput,
  ActionParams,
  ActionStatus,
  ActionType,
  defineQueryFeeModels,
  OrderDirection,
  QueryFeeModels,
} from '@graphprotocol/indexer-common'
import { CombinedError } from '@urql/core'
import { GraphQLError } from 'graphql'
import {
  allocateToNotPublishedDeployment,
  createTestManagementClient,
  invalidReallocateAction,
  invalidUnallocateAction,
  queuedAllocateAction,
  subgraphDeployment1,
  subgraphDeployment2,
  subgraphDeployment3,
  notPublishedSubgraphDeployment,
} from '../util'

const QUEUE_ACTIONS_MUTATION = gql`
  mutation queueActions($actions: [ActionInput!]!) {
    queueActions(actions: $actions) {
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
      failureReason
      status
      protocolNetwork
    }
  }
`

const APPROVE_ACTIONS_MUTATION = gql`
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
      failureReason
      status
      protocolNetwork
    }
  }
`

const CANCEL_ACTIONS_MUTATION = gql`
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
      failureReason
      status
      protocolNetwork
    }
  }
`

const UPDATE_ACTIONS_MUTATION = gql`
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
      failureReason
      status
      protocolNetwork
    }
  }
`

const ACTIONS_QUERY = gql`
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
      failureReason
      status
      protocolNetwork
    }
  }
`

const DELETE_ACTIONS_MUTATION = gql`
  mutation deleteActions($actionIDs: [Int!]!) {
    deleteActions(actionIDs: $actionIDs)
  }
`
type ActionTestInput = Record<string, any>
async function actionInputToExpected(
  input: ActionInput,
  id: number,
): Promise<ActionTestInput> {
  const expected: ActionTestInput = { ...input }
  expected.id = id

  for (const actionKey in Action.getAttributes()) {
    if (!actionKey.includes('At') && expected[actionKey] === undefined) {
      expected[actionKey] = null
    }
  }

  // We expect the protocol network to be transformed to it's CAIP2-ID
  // form for all inputs
  if (input.protocolNetwork === 'goerli') {
    expected.protocolNetwork = 'eip155:5'
  }

  return expected
}

let sequelize: Sequelize
let managementModels: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let logger: Logger
let client: IndexerManagementClient
let metrics: Metrics

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

const setup = async () => {
  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  managementModels = defineIndexerManagementModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  client = await createTestManagementClient(__DATABASE__, logger, true, metrics)
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
}
const teardownEach = async () => {
  // Clear out query fee model tables
  await queryFeeModels.allocationReceipts.truncate({ cascade: true })
  await queryFeeModels.vouchers.truncate({ cascade: true })
  await queryFeeModels.transferReceipts.truncate({ cascade: true })
  await queryFeeModels.transfers.truncate({ cascade: true })
  await queryFeeModels.allocationSummaries.truncate({ cascade: true })

  // Clear out indexer management models
  await managementModels.Action.truncate({ cascade: true })
  await managementModels.CostModel.truncate({ cascade: true })
  await managementModels.IndexingRule.truncate({ cascade: true })
  await managementModels.POIDispute.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
}

describe('Actions', () => {
  jest.setTimeout(60_000)
  beforeAll(setup)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  test('Queue and retrieve action', async () => {
    const inputAction = queuedAllocateAction
    const expected = await actionInputToExpected(inputAction, 1)

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [inputAction] }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { status: ActionStatus.QUEUED, source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [expected])
  })

  test('Queue many actions and retrieve all of a certain status with certain ordering', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    const queuedAllocateAction3 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction1.source = '1'
    queuedAllocateAction2.deploymentID = subgraphDeployment3
    queuedAllocateAction2.source = '2'
    queuedAllocateAction3.deploymentID = subgraphDeployment1
    queuedAllocateAction3.source = '3'

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.QUEUED,
            type: ActionType.ALLOCATE,
          },
          orderBy: ActionParams.SOURCE,
          orderDirection: OrderDirection.DESC,
        })
        .toPromise(),
    ).resolves.toHaveProperty(
      'data.actions',
      expecteds.sort((a, b) => (a.source > b.source ? -1 : 1)),
    )
  })

  test('Queue many actions and retrieve all of a certain status with invalid ordering', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    const queuedAllocateAction3 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction2.deploymentID = subgraphDeployment3
    queuedAllocateAction3.deploymentID = subgraphDeployment1

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.QUEUED,
            type: ActionType.ALLOCATE,
            source: 'indexerAgent',
          },
          orderBy: 'adonut',
          orderDirection: OrderDirection.DESC,
        })
        .toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            'Variable "$orderBy" got invalid value "adonut"; Value "adonut" does not exist in "ActionParams" enum. Did you mean the enum value "amount"?',
          ),
        ],
      }),
    )
  })

  test('Cancel all actions in queue', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction2.deploymentID = subgraphDeployment3

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    // Cancel all actions
    const toCancel = expecteds.map((action) => action.id)

    const expectedCancels = expecteds.map((action) => {
      action.status = ActionStatus.CANCELED
      return action
    })

    await expect(
      client.mutation(CANCEL_ACTIONS_MUTATION, { actionIDs: toCancel }).toPromise(),
    ).resolves.toHaveProperty('data.cancelActions', expectedCancels)

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.CANCELED,
            source: 'indexerAgent',
          },
          orderBy: ActionParams.ID,
          orderDirection: OrderDirection.ASC,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', expectedCancels)
  })

  test('Approve action in queue', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction2.deploymentID = subgraphDeployment3

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const actions = await client
      .query(ACTIONS_QUERY, { filter: { type: ActionType.ALLOCATE } })
      .toPromise()
    const subgraph1ActionID = actions.data.actions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((action: any) => action.deploymentID === subgraphDeployment2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((action: any) => action.id)

    const expectedApprovedAction = expecteds.find(
      (action) => action.deploymentID === subgraphDeployment2,
    )
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    expectedApprovedAction!['status'] = ActionStatus.APPROVED

    await expect(
      client
        .mutation(APPROVE_ACTIONS_MUTATION, { actionIDs: subgraph1ActionID })
        .toPromise(),
    ).resolves.toHaveProperty('data.approveActions', [expectedApprovedAction])

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.APPROVED,
            source: 'indexerAgent',
          },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [expectedApprovedAction])
  })

  test('Delete action in queue', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction2.deploymentID = subgraphDeployment3

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const actions = await client
      .query(ACTIONS_QUERY, { filter: { type: ActionType.ALLOCATE } })
      .toPromise()
    const actionIDs = actions.data.actions.map((action: any) => action.id)

    await expect(
      client.mutation(DELETE_ACTIONS_MUTATION, { actionIDs }).toPromise(),
    ).resolves.toHaveProperty('data.deleteActions', 3)
  })

  test('Delete non-existent action in queue', async () => {
    const actionIDs = [0]

    await expect(
      client.mutation(DELETE_ACTIONS_MUTATION, { actionIDs }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError('Delete action failed: No action items found with id in [0]'),
        ],
      }),
    )
  })

  test('Reject empty action input', async () => {
    const expectedFieldNamesAndTypes: [string, string][] = [
      ['status', 'ActionStatus'],
      ['type', 'ActionType'],
      ['source', 'String'],
      ['reason', 'String'],
      ['priority', 'Int'],
      ['protocolNetwork', 'String'],
    ]
    const graphQLErrors = expectedFieldNamesAndTypes.map(
      ([fieldName, fieldType]) =>
        new GraphQLError(
          `Variable "$actions" got invalid value {} at "actions[0]"; Field "${fieldName}" of required type "${fieldType}!" was not provided.`,
        ),
    )
    const expected = new CombinedError({ graphQLErrors })

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [{}] }).toPromise(),
    ).resolves.toHaveProperty('error', expected)
  })

  test('Reject action with invalid params for action type', async () => {
    const inputAction = invalidReallocateAction
    const expected = { ...inputAction, protocolNetwork: 'eip155:5' }
    const fields = JSON.stringify(expected)
    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [inputAction] }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `Failed to queue action: Invalid action input, actionInput: ${fields}`,
          ),
        ],
      }),
    )

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { status: ActionStatus.QUEUED, source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [])
  })

  test('Reject duplicate queued action from different source', async () => {
    const inputAction = queuedAllocateAction
    const expected = await actionInputToExpected(inputAction, 1)

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [inputAction] }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { status: ActionStatus.QUEUED, source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty(
      'data.actions',
      [expected].sort((a, b) => (a.id > b.id ? -1 : 1)),
    )

    const differentSourceSameTarget = { ...inputAction }
    differentSourceSameTarget.source = 'different'

    await expect(
      client
        .mutation(QUEUE_ACTIONS_MUTATION, { actions: [differentSourceSameTarget] })
        .toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `Duplicate action found in queue that effects 'Qmew9PZUJCoDzXqqU6vGyTENTKHrrN4dy5h94kertfudqy' but NOT overwritten because it has a different source and/or status. If you ` +
              `would like to replace the item currently in the queue please cancel it and then queue the proposed action`,
          ),
        ],
      }),
    )
  })

  test('Update duplicate approved action (effects deployment already targeted by approved action)', async () => {
    const inputAction = queuedAllocateAction
    const expected = await actionInputToExpected(inputAction, 1)

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [inputAction] }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    const actions = await client
      .query(ACTIONS_QUERY, { filter: { type: ActionType.ALLOCATE } })
      .toPromise()
    const subgraph1ActionID = actions.data.actions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((action: any) => action.deploymentID === queuedAllocateAction.deploymentID)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((action: any) => action.id)

    const expectedApprovedAction = { ...expected }
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    expectedApprovedAction!['status'] = ActionStatus.APPROVED

    await expect(
      client
        .mutation(APPROVE_ACTIONS_MUTATION, { actionIDs: subgraph1ActionID })
        .toPromise(),
    ).resolves.toHaveProperty('data.approveActions', [expectedApprovedAction])

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.APPROVED,
            source: 'indexerAgent',
          },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [expectedApprovedAction])

    const updateAction = { ...inputAction }
    updateAction.amount = '25000'
    updateAction.status = ActionStatus.APPROVED

    const expectedUpdated = { ...expectedApprovedAction }
    expectedUpdated.amount = '25000'

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [updateAction] }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', [expectedUpdated])

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { status: ActionStatus.APPROVED, source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [expectedUpdated])
  })

  test('Reject action with deployment not on network', async () => {
    const inputActions = [allocateToNotPublishedDeployment]

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `No subgraphDeployment with ipfsHash = '${notPublishedSubgraphDeployment}' found on the network`,
          ),
        ],
      }),
    )
  })

  test('Reject unallocate action with inactive allocationID', async () => {
    // This allocation has been closed on chain
    const closedAllocation = '0x0001572b5fde192fc1c65630fabb5e13d3ad173e'

    // Reuse a valid inputAction but use an allocationID dedicated to this test purpose,
    // as the previously used allocationID does not exist on chain.
    const inputActions = [{ ...invalidUnallocateAction, allocationID: closedAllocation }]

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `An active allocation does not exist with id = '${closedAllocation}'`,
          ),
        ],
      }),
    )
  })

  test('Reject approve request with nonexistent actionID ', async () => {
    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    queuedAllocateAction1.deploymentID = subgraphDeployment2
    queuedAllocateAction2.deploymentID = subgraphDeployment3

    const inputActions = [
      queuedAllocateAction,
      queuedAllocateAction1,
      queuedAllocateAction2,
    ]
    const expecteds = await Promise.all(
      inputActions.map(async (action, key) => {
        return await actionInputToExpected(action, key + 1)
      }),
    )

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      client.mutation(APPROVE_ACTIONS_MUTATION, { actionIDs: [100, 200] }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `Approve action failed: No action items found with id in [100,200]`,
          ),
        ],
      }),
    )

    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: {
            status: ActionStatus.APPROVED,
            source: 'indexerAgent',
          },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [])
  })

  test('Reject queueing for action that has recently failed', async () => {
    const failedAction = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:5',
    } as ActionInput

    const proposedAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'goerli',
    } as ActionInput

    await managementModels.Action.create(failedAction, {
      validate: true,
      returning: true,
    })

    const result = await client
      .mutation(QUEUE_ACTIONS_MUTATION, { actions: [proposedAction] })
      .toPromise()

    expect(result).toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `Recently executed 'allocate' action found in queue targeting '${subgraphDeployment1}', ignoring.`,
          ),
        ],
      }),
    )
    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [
      await actionInputToExpected(failedAction, 1),
    ])
  })

  test('Reject queueing for action that has recently succeeded', async () => {
    const successfulAction = {
      status: ActionStatus.SUCCESS,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:5',
    } as ActionInput

    const proposedAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'goerli',
    } as ActionInput

    await managementModels.Action.create(successfulAction, {
      validate: true,
      returning: true,
    })

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [proposedAction] }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `Recently executed 'allocate' action found in queue targeting '${subgraphDeployment1}', ignoring.`,
          ),
        ],
      }),
    )
    await expect(
      client
        .query(ACTIONS_QUERY, {
          filter: { source: 'indexerAgent' },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.actions', [
      await actionInputToExpected(successfulAction, 1),
    ])
  })

  test('Update all queued unallocate actions', async () => {
    const queuedUnallocateAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.UNALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:5',
    } as ActionInput

    const queuedAllocateAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      force: false,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'goerli',
    } as ActionInput

    await managementModels.Action.create(queuedUnallocateAction, {
      validate: true,
      returning: true,
    })

    const queuedAllocateAction1 = { ...queuedAllocateAction }
    const queuedAllocateAction2 = { ...queuedAllocateAction }
    queuedAllocateAction2.deploymentID = subgraphDeployment2

    const inputActions = [queuedAllocateAction1, queuedAllocateAction2]
    const expecteds = (
      await Promise.all(
        inputActions.sort().map(async (action, key) => {
          return await actionInputToExpected(action, key + 1)
        }),
      )
    ).sort((a, b) => a.id - b.id)

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const updatedExpecteds = expecteds.map((value) => {
      value.force = true
      return value
    })

    await expect(
      client
        .mutation(UPDATE_ACTIONS_MUTATION, {
          filter: { type: 'allocate' },
          action: {
            force: true,
          },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.updateActions', updatedExpecteds)
  })
})
