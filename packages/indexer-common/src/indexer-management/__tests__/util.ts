import {
  ActionInput,
  ActionStatus,
  ActionType,
  createIndexerManagementClient,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  IndexerManagementClient,
  IndexerManagementDefaults,
  MultiNetworks,
  Network,
  specification,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createMetrics,
  Logger,
  parseGRT,
} from '@graphprotocol/common-ts'

export const createTestManagementClient = async (
  databaseOptions: any,
  logger: Logger,
  injectDai: boolean,
): Promise<IndexerManagementClient> => {
  // Spin up db
  const sequelize = await connectDatabase(databaseOptions)
  const queryFeeModels = defineQueryFeeModels(sequelize)
  const managementModels = defineIndexerManagementModels(sequelize)
  await sequelize.sync({ force: true })
  const metrics = createMetrics()
  const statusEndpoint = 'http://localhost:8030/graphql'
  const graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
    [],
  )
  const indexNodeIDs = ['node_1']

  const defaults: IndexerManagementDefaults = {
    globalIndexingRule: {
      allocationAmount: parseGRT('100'),
      parallelAllocations: 1,
      requireSupported: true,
      safety: true,
      protocolNetwork: 'goerli',
    },
  }

  // TODO: QUESTION: how do we setup a test provider? In the past we did getTestProvider('goerli') but here you can only provide the url string?
  const networkSpecification = specification.NetworkSpecification.parse({
    networkIdentifier: 'goerli',
    gateway: {
      url: 'http://localhost:8030/',
    },
    networkProvider: { url: 'http://test-url.xyz' },
    indexerOptions: {
      address: '0xtest',
      mnemonic: 'foo',
      url: 'http://test-indexer.xyz',
    },
    subgraphs: {
      networkSubgraph: {
        url: 'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli',
      },
      epochSubgraph: { url: 'http://test-url.xyz' },
    },
    transactionMonitoring: {
      gasIncreaseTimeout: 240000,
      gasIncreaseFactor: 1.2,
      baseFeePerGasMax: 100 * 10 ** 9,
      maxTransactionAttempts: 0,
    },
    dai: {
      contractAddress: '0x4e8a4C63Df58bf59Fef513aB67a76319a9faf448',
      inject: injectDai,
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

  return await createIndexerManagementClient({
    models: managementModels,
    graphNode,
    indexNodeIDs,
    logger,
    defaults,
    multiNetworks,
  })
}

export const defaults: IndexerManagementDefaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
    parallelAllocations: 1,
    requireSupported: true,
    safety: true,
  },
}

export const subgraphDeployment1 = 'Qmew9PZUJCoDzXqqU6vGyTENTKHrrN4dy5h94kertfudqy'
export const subgraphDeployment2 = 'QmWq1pmnhEvx25qxpYYj9Yp6E1xMKMVoUjXVQBxUJmreSe'
export const subgraphDeployment3 = 'QmRhH2nhNibDVPZmYqq3TUZZARZ77vgjYCvPNiGBCogtgM'
export const notPublishedSubgraphDeployment =
  'QmeqJ6hsdyk9dVbo1tvRgAxWrVS3rkERiEMsxzPShKLco6'

export const queuedAllocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.ALLOCATE,
  deploymentID: subgraphDeployment1,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'goerli',
} as ActionInput

export const allocateToNotPublishedDeployment = {
  status: ActionStatus.QUEUED,
  type: ActionType.ALLOCATE,
  deploymentID: notPublishedSubgraphDeployment,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'goerli',
} as ActionInput

export const invalidUnallocateAction = {
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
  protocolNetwork: 'goerli',
} as ActionInput

export const invalidReallocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.REALLOCATE,
  deploymentID: subgraphDeployment1,
  allocationID: '0x8f63930129e585c69482b56390a09b6b176f4a4c',
  poi: undefined,
  amount: undefined,
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'goerli',
} as ActionInput
