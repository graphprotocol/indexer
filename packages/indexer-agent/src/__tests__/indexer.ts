import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
} from '@graphprotocol/common-ts'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  IndexerManagementClient,
  IndexerManagementModels,
  GraphNode,
  Operator,
  Network,
  POIDisputeAttributes,
  specification,
  QueryFeeModels,
  defineQueryFeeModels,
  MultiNetworks,
} from '@graphprotocol/indexer-common'
import { BigNumber } from 'ethers'
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
  protocolNetwork: 'eip155:5',
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
  protocolNetwork: 'eip155:5',
}

const POI_DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | BigNumber | number | undefined
> = {
  allocationID: x => x,
  subgraphDeploymentID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => x,
  allocationProof: x => x,
  closedEpoch: x => +x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => +x,
  closedEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => +x,
  previousEpochReferenceProof: x => x,
  status: x => x,
  protocolNetwork: x => x,
}

/**
 * Parses a POI dispute returned from the indexer management GraphQL
 * API into normalized form.
 */
const disputeFromGraphQL = (
  dispute: Partial<POIDisputeAttributes>,
): POIDisputeAttributes => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(dispute)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (POI_DISPUTES_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as POIDisputeAttributes
}

declare const __DATABASE__: never

let sequelize: Sequelize
let models: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let logger: Logger
let indexerManagementClient: IndexerManagementClient
let graphNode: GraphNode
let operator: Operator
let metrics: Metrics

const PUBLIC_JSON_RPC_ENDPOINT = 'https://ethereum-goerli.publicnode.com'

const testProviderUrl =
  process.env.INDEXER_TEST_JRPC_PROVIDER_URL ?? PUBLIC_JSON_RPC_ENDPOINT

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

  const indexNodeIDs = ['node_1']

  graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
    indexNodeIDs,
  )

  const networkSpecification = specification.NetworkSpecification.parse({
    networkIdentifier: 'eip155:5',
    gateway: {
      url: 'http://127.0.0.1:8030/',
    },
    networkProvider: {
      url: testProviderUrl,
    },
    indexerOptions: {
      address: '0xf56b5d582920E4527A818FBDd801C0D80A394CB8',
      mnemonic:
        'famous aspect index polar tornado zero wedding electric floor chalk tenant junk',
      url: 'http://test-indexer.xyz',
    },
    subgraphs: {
      maxBlockDistance: 10000,
      networkSubgraph: {
        url: 'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli',
      },
      epochSubgraph: {
        url: 'http://test-url.xyz',
      },
      TAPSubgraph: {
        url: 'https://api.thegraph.com/subgraphs/name/graphprotocol/scalar-tap-arbitrum-sepolia',
      },
    },
    transactionMonitoring: {
      gasIncreaseTimeout: 240000,
      gasIncreaseFactor: 1.2,
      baseFeePerGasMax: 100 * 10 ** 9,
      maxTransactionAttempts: 0,
    },
    dai: {
      contractAddress: '0x4e8a4C63Df58bf59Fef513aB67a76319a9faf448',
      inject: false,
    },
  })

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

  indexerManagementClient = await createIndexerManagementClient({
    models,
    graphNode,
    indexNodeIDs,
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
      protocolNetwork: 'eip155:5',
    }

    const disputes = [badDispute]

    await expect(operator.storePoiDisputes(disputes)).rejects.toThrow(
      'Failed to store potential POI disputes',
    )
  })

  test('Store POI Disputes is idempotent', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedResult = disputes.map((dispute: Record<string, any>) => {
      return disputeFromGraphQL(dispute)
    })
    await expect(operator.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(operator.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(operator.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
  })

  test('Fetch POIDisputes', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedResult = disputes.map((dispute: Record<string, any>) => {
      return disputeFromGraphQL(dispute)
    })
    const expectedFilteredResult = [disputeFromGraphQL(TEST_DISPUTE_2)]
    await expect(operator.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(
      operator.fetchPOIDisputes('potential', 205, 'eip155:5'),
    ).resolves.toEqual(expectedFilteredResult)
  })
})
