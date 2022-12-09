/* eslint-disable @typescript-eslint/no-explicit-any */

import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import { BigNumber, ethers, Wallet } from 'ethers'
import {
  connectContracts,
  connectDatabase,
  createLogger,
  Logger,
  mutable,
  NetworkContracts,
  parseGRT,
  toAddress,
} from '@graphprotocol/common-ts'

import {
  createIndexerManagementClient,
  IndexerManagementClient,
  IndexerManagementDefaults,
} from '../../client'
import {
  Action,
  defineIndexerManagementModels,
  IndexerManagementModels,
} from '../../models'
import {
  defineQueryFeeModels,
  ActionInput,
  ActionParams,
  ActionStatus,
  ActionType,
  AllocationReceiptCollector,
  IndexingStatusResolver,
  NetworkSubgraph,
  OrderDirection,
  QueryFeeModels,
  TransactionManager,
  NetworkMonitor,
  EpochSubgraph,
  resolveChainId,
} from '@graphprotocol/indexer-common'
import { CombinedError } from '@urql/core'
import { GraphQLError } from 'graphql'

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
    }
  }
`

const DELETE_ACTIONS_MUTATION = gql`
  mutation deleteActions($actionIDs: [Int!]!) {
    deleteActions(actionIDs: $actionIDs)
  }
`
async function actionInputToExpected(
  input: ActionInput,
  id: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ [key: string]: any }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expected: Record<string, any> = { ...input }
  expected.id = id

  for (const actionKey in Action.getAttributes()) {
    if (!actionKey.includes('At') && expected[actionKey] === undefined) {
      expected[actionKey] = null
    }
  }
  return expected
}

const defaults: IndexerManagementDefaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
    parallelAllocations: 1,
    requireSupported: true,
  },
}

const subgraphDeployment1 = 'Qmew9PZUJCoDzXqqU6vGyTENTKHrrN4dy5h94kertfudqy'
const subgraphDeployment2 = 'QmWq1pmnhEvx25qxpYYj9Yp6E1xMKMVoUjXVQBxUJmreSe'
const subgraphDeployment3 = 'QmRhH2nhNibDVPZmYqq3TUZZARZ77vgjYCvPNiGBCogtgM'
const notPublishedSubgraphDeployment = 'QmeqJ6hsdyk9dVbo1tvRgAxWrVS3rkERiEMsxzPShKLco6'

const queuedAllocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.ALLOCATE,
  deploymentID: subgraphDeployment1,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
} as ActionInput

const allocateToNotPublishedDeployment = {
  status: ActionStatus.QUEUED,
  type: ActionType.ALLOCATE,
  deploymentID: notPublishedSubgraphDeployment,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
} as ActionInput

const queuedUnallocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.UNALLOCATE,
  allocationID: '0x8f63930129e585c69482b56390a09b6b176f4a4c',
  deploymentID: subgraphDeployment1,
  amount: undefined,
  poi: undefined,
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
} as ActionInput

// const queuedReallocateAction = {
//   status: ActionStatus.QUEUED,
//   type: ActionType.REALLOCATE,
//   allocationID: '0x8f63930129e585c69482b56390a09b6b176f4a4c',
//   deploymentID: subgraphDeployment1,
//   poi: undefined,
//   amount: '27000',
//   force: false,
//   source: 'indexerAgent',
//   reason: 'indexingRule',
//   priority: 0,
// } as ActionInput

const invalidReallocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.REALLOCATE,
  allocationID: '0x8f63930129e585c69482b56390a09b6b176f4a4c',
  deploymentID: subgraphDeployment1,
  poi: undefined,
  amount: undefined,
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
} as ActionInput

let ethereum: ethers.providers.BaseProvider
let sequelize: Sequelize
let managementModels: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let address: string
let contracts: NetworkContracts
let logger: Logger
let indexingStatusResolver: IndexingStatusResolver
let networkSubgraph: NetworkSubgraph
let client: IndexerManagementClient
let transactionManager: TransactionManager
let wallet: Wallet

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

const setup = async () => {
  const statusEndpoint = 'http://localhost:8030/graphql'
  const deploymentManagementEndpoint = 'http://localhost:8020/'
  address = '0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1'

  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  managementModels = defineIndexerManagementModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
  ethereum = ethers.getDefaultProvider('goerli')
  wallet = Wallet.createRandom()
  contracts = await connectContracts(ethereum, 5)
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })

  indexingStatusResolver = new IndexingStatusResolver({
    logger: logger,
    statusEndpoint,
  })
  networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint:
      'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli',
    deployment: undefined,
  })
  transactionManager = new TransactionManager(
    ethereum,
    wallet,
    mutable(false),
    mutable(true),
    240000,
    1.2,
    100 * 10 ** 9,
    0,
  )

  const receiptCollector = new AllocationReceiptCollector({
    logger,
    transactionManager: transactionManager,
    models: queryFeeModels,
    allocationExchange: contracts.allocationExchange,
    collectEndpoint: 'http://localhost:8030/',
    voucherRedemptionThreshold: BigNumber.from(200),
    voucherRedemptionBatchThreshold: BigNumber.from(2000),
    voucherRedemptionMaxBatchSize: 100,
  })

  const epochSubgraph = await EpochSubgraph.create(
    'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli',
  )

  const networkMonitor = new NetworkMonitor(
    resolveChainId('goerli'),
    contracts,
    toAddress('0xc61127cdfb5380df4214b0200b9a07c7c49d34f9'),
    logger,
    indexingStatusResolver,
    networkSubgraph,
    ethereum,
    epochSubgraph,
  )

  client = await createIndexerManagementClient({
    models: managementModels,
    address,
    contracts,
    indexingStatusResolver,
    deploymentManagementEndpoint,
    networkSubgraph,
    receiptCollector,
    transactionManager,
    networkMonitor,
    logger,
    defaults,
    features: {
      injectDai: true,
    },
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
    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [{}] }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            'Variable "$actions" got invalid value {} at "actions[0]"; Field "status" of required type "ActionStatus!" was not provided.',
          ),
          new GraphQLError(
            'Variable "$actions" got invalid value {} at "actions[0]"; Field "type" of required type "ActionType!" was not provided.',
          ),
          new GraphQLError(
            'Variable "$actions" got invalid value {} at "actions[0]"; Field "source" of required type "String!" was not provided.',
          ),
        ],
      }),
    )
  })

  test('Reject action with invalid params for action type', async () => {
    const inputAction = invalidReallocateAction

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: [inputAction] }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            'Failed to queue action: Invalid action input, actionInput: {"status":"queued","type":"reallocate","deploymentID":"Qmew9PZUJCoDzXqqU6vGyTENTKHrrN4dy5h94kertfudqy","allocationID":"0x8f63930129e585c69482b56390a09b6b176f4a4c","force":false,"source":"indexerAgent","reason":"indexingRule","priority":0}',
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
    const inputActions = [queuedUnallocateAction]

    await expect(
      client.mutation(QUEUE_ACTIONS_MUTATION, { actions: inputActions }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            `An active allocation does not exist with id = '0x8f63930129e585c69482b56390a09b6b176f4a4c'`,
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
    } as ActionInput

    const proposedAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
    } as ActionInput

    await managementModels.Action.create(failedAction, {
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
    } as ActionInput

    const proposedAction = {
      status: ActionStatus.QUEUED,
      type: ActionType.ALLOCATE,
      deploymentID: subgraphDeployment1,
      amount: '10000',
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
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
})
