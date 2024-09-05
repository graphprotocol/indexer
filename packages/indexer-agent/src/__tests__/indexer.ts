import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
} from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  GraphNode,
  Operator,
  Network,
  POIDisputeAttributes,
  specification,
  QueryFeeModels,
  defineQueryFeeModels,
  MultiNetworks,
  createIndexerManagementYogaClient,
  loadTestYamlConfig,
} from '@graphprotocol/indexer-common'
import { Sequelize } from 'sequelize'

const TEST_DISPUTE_1: POIDisputeAttributes = {
  allocationID: '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
  subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '500000000000000000000000',
  allocationProof:
    '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
  closedEpoch: 203,
  closedEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  closedEpochStartBlockNumber: 848484,
  closedEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  previousEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  previousEpochStartBlockNumber: 848484,
  previousEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  status: 'potential',
  protocolNetwork: 'eip155:421614',
}
const TEST_DISPUTE_2: POIDisputeAttributes = {
  allocationID: '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
  subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '5000000',
  allocationProof:
    '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
  closedEpoch: 210,
  closedEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  closedEpochStartBlockNumber: 848484,
  closedEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  previousEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  previousEpochStartBlockNumber: 848484,
  previousEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  status: 'potential',
  protocolNetwork: 'eip155:421614',
}

declare const __DATABASE__: never

let sequelize: Sequelize
let models: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let logger: Logger
let indexerManagementClient: Awaited<
  ReturnType<typeof createIndexerManagementYogaClient>
>
let graphNode: GraphNode
let operator: Operator
let metrics: Metrics

const setupAll = async () => {
  metrics = createMetrics()
}

const setup = async () => {
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()
  logger = createLogger({
    name: 'IndexerAgent',
    async: false,
    level: 'trace',
  })
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
  )

  const yamlObj = loadTestYamlConfig()
  const networkSpecification = specification.NetworkSpecification.parse(yamlObj)

  const network = await Network.create(
    logger,
    networkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
  )

  const multiNetworks = new MultiNetworks(
    [network],
    (n: Network) => n.specification.networkIdentifier,
  )

  indexerManagementClient = await createIndexerManagementYogaClient({
    models,
    graphNode,
    logger,
    defaults: {
      globalIndexingRule: {
        allocationAmount: parseGRT('1000'),
        parallelAllocations: 1,
      },
    },
    multiNetworks,
  })

  operator = new Operator(logger, indexerManagementClient, networkSpecification)
}

const teardown = async () => {
  await sequelize.drop({})
}

describe('Indexer tests', () => {
  jest.setTimeout(60_000)
  beforeAll(setupAll)
  beforeEach(setup)
  afterEach(teardown)

  // test('Parse Dispute from GraphQL', async () => {})
  test('Store POI Disputes rejects invalid indexer address', async () => {
    const badDispute: POIDisputeAttributes = {
      allocationID: '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
      subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
      allocationIndexer: '0xCOFFEECOFFEECOFFEE',
      allocationAmount: '500000000',
      allocationProof:
        '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
      closedEpoch: 203,
      closedEpochStartBlockHash:
        '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
      closedEpochStartBlockNumber: 848484,
      closedEpochReferenceProof:
        '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
      previousEpochStartBlockHash:
        '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
      previousEpochStartBlockNumber: 848484,
      previousEpochReferenceProof:
        '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
      status: 'potential',
      protocolNetwork: 'eip155:421614',
    }

    const disputes = [badDispute]

    await expect(operator.storePoiDisputes(disputes)).rejects.toThrow(
      'Failed to store potential POI disputes',
    )
  })

  test('Store POI Disputes is idempotent', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    const result1 = (await operator.storePoiDisputes(disputes)).map(a => ({
      ...a,
      allocationAmount: a.allocationAmount.toString(),
    }))
    expect(result1).toEqual(disputes)
    const result2 = (await operator.storePoiDisputes(disputes)).map(a => ({
      ...a,
      allocationAmount: a.allocationAmount.toString(),
    }))
    expect(result2).toEqual(disputes)
    const result3 = (await operator.storePoiDisputes(disputes)).map(a => ({
      ...a,
      allocationAmount: a.allocationAmount.toString(),
    }))
    expect(result3).toEqual(disputes)
  })

  test('Fetch POIDisputes', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    const result1 = (await operator.storePoiDisputes(disputes)).map(a => ({
      ...a,
      allocationAmount: a.allocationAmount.toString(),
    }))
    expect(result1).toEqual(disputes)
    const result2 = (
      await operator.fetchPOIDisputes('potential', 205, 'eip155:421614')
    ).map(a => ({ ...a, allocationAmount: a.allocationAmount.toString() }))
    expect(result2).toEqual([TEST_DISPUTE_2])
  })
})
