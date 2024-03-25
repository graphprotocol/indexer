import {
  AllocationReceiptCollector,
  defineQueryFeeModels,
  GraphNode,
  Network,
  QueryFeeModels,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  toAddress,
} from '@graphprotocol/common-ts'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { Sequelize } from 'sequelize'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never
let logger: Logger
let receiptCollector: AllocationReceiptCollector
let metrics: Metrics
let queryFeeModels: QueryFeeModels
let sequelize: Sequelize
const timeout = 30000

const startRAVProcessing = jest.spyOn(
  AllocationReceiptCollector.prototype,
  'startRAVProcessing',
)
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
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
    [],
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
    sequelize.getQueryInterface(),
  )
  receiptCollector = network.receiptCollector
}

const rav = {
  allocationId: toAddress('edde47df40c29949a75a6693c77834c00b8ad626'),
  last: true,
  final: false,
  timestampNs: 1709067401177959664n,
  valueAggregate: 20000000000000n,
  signature: Buffer.from(
    'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
    'hex',
  ),
  senderAddress: toAddress('ffcf8fdee72ac11b5c542428b35eef5769c409f0'),
  redeemedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
  await queryFeeModels.receiptAggregateVouchers.create(rav)
}
const teardownEach = async () => {
  // Clear out query fee model tables
  await queryFeeModels.receiptAggregateVouchers.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
}

describe('TAP', () => {
  beforeAll(setup, timeout)
  beforeEach(setupEach, timeout)
  afterEach(teardownEach, timeout)
  afterAll(teardownAll, timeout)
  test(
    'test if startRAVProcessing is called',
    async () => {
      expect(startRAVProcessing).toHaveBeenCalled()
    },
    timeout,
  )

  test(
    'test getPendingRAVs',
    async () => {
      const ravs = await receiptCollector['pendingRAVs']()

      expect(ravs).toEqual([
        expect.objectContaining({
          allocationId: rav.allocationId,
          final: rav.final,
          last: rav.last,
          senderAddress: rav.senderAddress,
          signature: rav.signature,
          timestampNs: rav.timestampNs,
          valueAggregate: rav.valueAggregate,
        }),
      ])
    },
    timeout,
  )
})
