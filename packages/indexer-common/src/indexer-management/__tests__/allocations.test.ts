import {
  Action,
  ActionType,
  AllocationManager,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  IndexerManagementModels,
  Network,
  QueryFeeModels,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
} from '@graphprotocol/common-ts'
import {
  invalidReallocateAction,
  invalidUnallocateAction,
  queuedAllocateAction,
  testNetworkSpecification,
} from './util'
import { Sequelize } from 'sequelize'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

let allocationManager: AllocationManager
let logger: Logger
let managementModels: IndexerManagementModels
let metrics: Metrics
let queryFeeModels: QueryFeeModels
let sequelize: Sequelize

const setup = async () => {
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()
  sequelize = await connectDatabase(__DATABASE__)
  managementModels = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
  )
  // TODO: Can we expose AllocationManager from client so we don't need to build this separately?

  allocationManager = new AllocationManager(
    logger.child({ protocolNetwork: network.specification.networkIdentifier }),
    managementModels,
    graphNode,
    network,
  )
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

describe('Allocation Manager', () => {
  beforeAll(setup)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  // We have been rate-limited on CI as this test uses RPC providers,
  // so we set its timeout to a higher value than usual.
  jest.setTimeout(30_000)

  // Reuse an existing allocation allocated GRT
  const allocationID = '0xa4cdbf8902a2600bce6a2286dde74abb1a59bddc'

  // Redefine test actions to use that allocation ID
  const unallocateAction = {
    ...invalidUnallocateAction,
    poi: '0x1', // non-zero POI
    allocationID,
  }
  const reallocateAction = {
    ...invalidReallocateAction,
    amount: '10000',
    allocationID,
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore: Mocking the Action type for this test
  const actions = [queuedAllocateAction, unallocateAction, reallocateAction] as Action[]

  test('stakeUsageSummary() correctly calculates token balances for array of actions', async () => {
    const balances = await Promise.all(
      actions.map((action: Action) => allocationManager.stakeUsageSummary(action)),
    )

    const allocate = balances[0]
    const unallocate = balances[1]
    const reallocate = balances[2]

    // Allocate test action
    expect(allocate.action.type).toBe(ActionType.ALLOCATE)
    expect(allocate.allocates).toStrictEqual(parseGRT('10000'))
    expect(allocate.rewards.isZero()).toBeTruthy()
    expect(allocate.unallocates.isZero()).toBeTruthy()
    expect(allocate.balance).toStrictEqual(parseGRT('10000'))

    // Unallocate test action
    expect(unallocate.action.type).toBe(ActionType.UNALLOCATE)
    expect(unallocate.allocates.isZero()).toBeTruthy()
    expect(unallocate.rewards.isZero()).toBeFalsy()
    expect(unallocate.unallocates).toStrictEqual(parseGRT('10000'))
    expect(unallocate.balance).toStrictEqual(
      unallocate.allocates.sub(unallocate.unallocates).sub(unallocate.rewards),
    )

    // This Reallocate test Action intentionally uses a null or zeroed POI, so it should not accrue rewards.
    expect(reallocate.action.type).toBe(ActionType.REALLOCATE)
    expect(reallocate.allocates).toStrictEqual(parseGRT('10000'))
    expect(reallocate.rewards.isZero()).toBeTruthy()
    expect(reallocate.unallocates).toStrictEqual(parseGRT('10000'))
    expect(reallocate.balance).toStrictEqual(parseGRT('0'))
  })

  test('validateActionBatchFeasibility() validates and correctly sorts actions based on net token balance', async () => {
    const reordered = await allocationManager.validateActionBatchFeasibilty(actions)
    expect(reordered[0]).toStrictEqual(unallocateAction)
    expect(reordered[1]).toStrictEqual(reallocateAction)
    expect(reordered[2]).toStrictEqual(queuedAllocateAction)
  })
})
