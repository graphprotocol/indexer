import {
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  Network,
  QueryFeeModels,
  TapCollector,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
} from '@graphprotocol/common-ts'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { Sequelize } from 'sequelize'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never
let logger: Logger
let tapCollector: TapCollector
let metrics: Metrics
let queryFeeModels: QueryFeeModels
let sequelize: Sequelize
const timeout = 30000

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
  const models = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
    'https://test-ipfs-endpoint.xyz',
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    models,
    queryFeeModels,
    graphNode,
    metrics,
  )
  tapCollector = network.tapCollector!
}

jest.spyOn(TapCollector.prototype, 'startRAVProcessing').mockImplementation()

// Skipped because this hits real RPC endpoints.
// This test should be re-enabled when we have a test environment that this can hit instead.
describe.skip('Validate TAP queries', () => {
  beforeAll(setup, timeout)

  test(
    'test `getAllocationsfromAllocationIds` query is valid',
    async () => {
      const mockedFunc = jest.spyOn(tapCollector.networkSubgraph, 'query')
      const result = await tapCollector['getAllocationsfromAllocationIds']([])
      expect(result).toEqual([])
      // this subgraph is in an eventual
      // we check if it was called more than 0 times
      expect(mockedFunc).toBeCalled()
      mockedFunc.mockReset()
    },
    timeout,
  )

  test(
    'test `findTransactionsForRavs` query is valid',
    async () => {
      const mockedFunc = jest.spyOn(tapCollector.tapSubgraph, 'query')

      const result = await tapCollector['findTransactionsForRavs']([])
      expect(result.transactions).toEqual([])
      expect(result._meta.block.hash.length).toEqual(66)
      expect(mockedFunc).toBeCalledTimes(1)
      mockedFunc.mockReset()
    },
    timeout,
  )
})
