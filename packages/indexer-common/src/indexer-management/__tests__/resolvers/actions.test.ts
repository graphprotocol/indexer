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

import {
  Action,
  defineIndexerManagementModels,
  IndexerManagementModels,
} from '../../models'
import { defineQueryFeeModels, QueryFeeModels } from '@graphprotocol/indexer-common'
import {
  createTestManagementClient,
  invalidReallocateAction,
  invalidUnallocateAction,
  queuedAllocateAction,
  subgraphDeployment1,
  subgraphDeployment2,
  subgraphDeployment3,
} from '../util'
import { buildHTTPExecutor } from '@graphql-tools/executor-http'
import { GraphQLError } from 'graphql'
import { isAsyncIterable } from 'graphql-yoga'
import { ActionStatus, ActionType, ActionInput } from '../../../schema/types.generated'

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
  mutation approveActions($actionIDs: [String!]!) {
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
  mutation cancelActions($actionIDs: [String!]!) {
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
  mutation deleteActions($actionIDs: [String!]!) {
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
  if (input.protocolNetwork === 'sepolia') {
    expected.protocolNetwork = 'eip155:11155111'
  }

  return expected
}

let sequelize: Sequelize
let managementModels: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let logger: Logger
let executor: ReturnType<typeof buildHTTPExecutor>
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
  const client = await createTestManagementClient(__DATABASE__, logger, true, metrics)
  executor = buildHTTPExecutor({
    fetch: client.yoga.fetch,
  })
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: {
          actions: [inputAction],
        },
      }),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: { filter: { status: ActionStatus.queued, source: 'indexerAgent' } },
      }),
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.queued,
            type: ActionType.allocate,
          },
          orderBy: 'source',
          orderDirection: 'desc',
        },
      }),
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.queued,
            type: ActionType.allocate,
            source: 'indexerAgent',
          },
          orderBy: 'adonut',
          orderDirection: 'desc',
        },
      }),
    ).resolves.toHaveProperty('errors', [
      {
        locations: [
          {
            column: 39,
            line: 1,
          },
        ],
        message:
          'Variable "$orderBy" got invalid value "adonut"; Value "adonut" does not exist in "ActionParams" enum. Did you mean the enum value "amount"?',
      },
    ])
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    // Cancel all actions
    const toCancel = expecteds.map((action) => action.id.toString())

    const expectedCancels = expecteds.map((action) => {
      action.status = ActionStatus.canceled
      return action
    })

    await expect(
      executor({ document: CANCEL_ACTIONS_MUTATION, variables: { actionIDs: toCancel } }),
    ).resolves.toHaveProperty('data.cancelActions', expectedCancels)

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.canceled,
            source: 'indexerAgent',
          },
          orderBy: 'id',
          orderDirection: 'asc',
        },
      }),
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const actions = await executor({
      document: ACTIONS_QUERY,
      variables: {
        filter: { type: ActionType.allocate },
      },
    })

    if (isAsyncIterable(actions)) {
      throw new Error('Expected actions to be an array')
    }

    const subgraph1ActionID = actions.data.actions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((action: any) => action.deploymentID === subgraphDeployment2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((action: any) => action.id.toString())

    const expectedApprovedAction = expecteds.find(
      (action) => action.deploymentID === subgraphDeployment2,
    )
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    expectedApprovedAction!['status'] = ActionStatus.approved

    await expect(
      executor({
        document: APPROVE_ACTIONS_MUTATION,
        variables: { actionIDs: subgraph1ActionID },
      }),
    ).resolves.toHaveProperty('data.approveActions', [expectedApprovedAction])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.approved,
            source: 'indexerAgent',
          },
        },
      }),
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const actions = await executor({
      document: ACTIONS_QUERY,
      variables: { filter: { type: ActionType.allocate } },
    })
    if (isAsyncIterable(actions)) {
      throw new Error('Expected actions to be an array')
    }

    const actionIDs = actions.data.actions.map((action: any) => action.id.toString())

    await expect(
      executor({ document: DELETE_ACTIONS_MUTATION, variables: { actionIDs } }),
    ).resolves.toHaveProperty('data.deleteActions', 3)
  })

  test('Delete non-existent action in queue', async () => {
    const actionIDs = ['0']

    await expect(
      executor({ document: DELETE_ACTIONS_MUTATION, variables: { actionIDs } }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['deleteActions'],
        locations: [{ line: 2, column: 3 }],
        message: 'Delete action failed: No action items found with id in [0]',
      },
    ])
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
    const result = await executor({
      document: QUEUE_ACTIONS_MUTATION,
      variables: { actions: [{}] },
    })
    if (isAsyncIterable(result)) {
      throw new Error('Expected result to be an async iterable')
    }
    expect(result).toHaveProperty('errors')
    expect(result.errors).toHaveLength(graphQLErrors.length)
  })

  test('Reject action with invalid params for action type', async () => {
    const inputAction = invalidReallocateAction

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [inputAction] },
      }),
    ).resolves.toHaveProperty('errors')

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: { status: ActionStatus.queued, source: 'indexerAgent' },
        },
      }),
    ).resolves.toHaveProperty('data.actions', [])
  })

  test('Reject duplicate queued action from different source', async () => {
    const inputAction = queuedAllocateAction
    const expected = await actionInputToExpected(inputAction, 1)

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [inputAction] },
      }),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: { status: ActionStatus.queued, source: 'indexerAgent' },
        },
      }),
    ).resolves.toHaveProperty(
      'data.actions',
      [expected].sort((a, b) => (a.id > b.id ? -1 : 1)),
    )

    const differentSourceSameTarget = { ...inputAction }
    differentSourceSameTarget.source = 'different'

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [differentSourceSameTarget] },
      }),
    ).resolves.toHaveProperty('errors')
  })

  test('Update duplicate approved action (effects deployment already targeted by approved action)', async () => {
    const inputAction = queuedAllocateAction
    const expected = await actionInputToExpected(inputAction, 1)

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [inputAction] },
      }),
    ).resolves.toHaveProperty('data.queueActions', [expected])

    const actions = await executor({
      document: ACTIONS_QUERY,
      variables: { filter: { type: ActionType.allocate } },
    })

    if (isAsyncIterable(actions)) {
      throw new Error('Expected actions to be an array')
    }

    const subgraph1ActionID = actions.data.actions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((action: any) => action.deploymentID === queuedAllocateAction.deploymentID)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((action: any) => action.id.toString())

    const expectedApprovedAction = { ...expected }
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    expectedApprovedAction!['status'] = ActionStatus.approved

    await expect(
      executor({
        document: APPROVE_ACTIONS_MUTATION,
        variables: { actionIDs: subgraph1ActionID },
      }),
    ).resolves.toHaveProperty('data.approveActions', [expectedApprovedAction])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.approved,
            source: 'indexerAgent',
          },
        },
      }),
    ).resolves.toHaveProperty('data.actions', [expectedApprovedAction])

    const updateAction = { ...inputAction }
    updateAction.amount = '25000'
    updateAction.status = ActionStatus.approved

    const expectedUpdated = { ...expectedApprovedAction }
    expectedUpdated.amount = '25000'

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [updateAction] },
      }),
    ).resolves.toHaveProperty('data.queueActions', [expectedUpdated])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: { status: ActionStatus.approved, source: 'indexerAgent' },
        },
      }),
    ).resolves.toHaveProperty('data.actions', [expectedUpdated])
  })

  test('Reject unallocate action with inactive allocationID', async () => {
    // This allocation has been closed on chain
    const closedAllocation = '0x0641209ae448c710ab8d04a8c8a13053d138d8c6'

    // Reuse a valid inputAction but use an allocationID dedicated to this test purpose,
    // as the previously used allocationID does not exist on chain.
    const inputActions = [{ ...invalidUnallocateAction, allocationID: closedAllocation }]

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['queueActions'],
        locations: [{ line: 2, column: 3 }],
        message: `An active allocation does not exist with id = '${closedAllocation}'`,
      },
    ])
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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    await expect(
      executor({
        document: APPROVE_ACTIONS_MUTATION,
        variables: { actionIDs: ['100', '200'] },
      }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['approveActions'],
        locations: [{ line: 2, column: 3 }],
        message: 'Approve action failed: No action items found with id in [100,200]',
      },
    ])

    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: {
            status: ActionStatus.approved,
            source: 'indexerAgent',
          },
        },
      }),
    ).resolves.toHaveProperty('data.actions', [])
  })

  test('Reject queueing for action that has recently failed', async () => {
    const failedAction = {
      status: ActionStatus.failed,
      type: ActionType.allocate,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:11155111',
    } satisfies ActionInput

    const proposedAction = {
      status: ActionStatus.queued,
      type: ActionType.allocate,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'sepolia',
    } satisfies ActionInput

    await managementModels.Action.create(failedAction, {
      validate: true,
      returning: true,
    })

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [proposedAction] },
      }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['queueActions'],
        locations: [{ line: 2, column: 3 }],
        message: `Recently executed 'allocate' action found in queue targeting '${subgraphDeployment1}', ignoring.`,
      },
    ])
    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: {
          filter: { source: 'indexerAgent' },
        },
      }),
    ).resolves.toHaveProperty('data.actions', [
      await actionInputToExpected(failedAction, 1),
    ])
  })

  test('Reject queueing for action that has recently succeeded', async () => {
    const successfulAction = {
      status: ActionStatus.success,
      type: ActionType.allocate,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:11155111',
    } satisfies ActionInput

    const proposedAction = {
      status: ActionStatus.queued,
      type: ActionType.allocate,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'sepolia',
    } satisfies ActionInput

    await managementModels.Action.create(successfulAction, {
      validate: true,
      returning: true,
    })

    await expect(
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: [proposedAction] },
      }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['queueActions'],
        locations: [{ line: 2, column: 3 }],
        message: `Recently executed 'allocate' action found in queue targeting '${subgraphDeployment1}', ignoring.`,
      },
    ])
    await expect(
      executor({
        document: ACTIONS_QUERY,
        variables: { filter: { source: 'indexerAgent' } },
      }),
    ).resolves.toHaveProperty('data.actions', [
      await actionInputToExpected(successfulAction, 1),
    ])
  })

  test('Update all queued unallocate actions', async () => {
    const queuedUnallocateAction = {
      status: ActionStatus.queued,
      type: ActionType.unallocate,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:11155111',
    } satisfies ActionInput

    const queuedAllocateAction = {
      status: ActionStatus.queued,
      type: ActionType.allocate,
      deploymentID: subgraphDeployment1,
      force: false,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      protocolNetwork: 'sepolia',
    } satisfies ActionInput

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
      executor({
        document: QUEUE_ACTIONS_MUTATION,
        variables: { actions: inputActions },
      }),
    ).resolves.toHaveProperty('data.queueActions', expecteds)

    const updatedExpecteds = expecteds.map((value) => {
      value.force = true
      return value
    })

    await expect(
      executor({
        document: UPDATE_ACTIONS_MUTATION,
        variables: {
          filter: { type: 'allocate' },
          action: {
            force: true,
          },
        },
      }),
    ).resolves.toHaveProperty('data.updateActions', updatedExpecteds)
  })
})
