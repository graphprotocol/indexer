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
  loadTestYamlConfig,
  Network,
  specification,
} from '@graphprotocol/indexer-common'
import { connectDatabase, Metrics, Logger, parseGRT } from '@graphprotocol/common-ts'

const yamlObj = loadTestYamlConfig()
export const testNetworkSpecification: specification.NetworkSpecification =
  specification.NetworkSpecification.parse(yamlObj)

export const createTestManagementClient = async (
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  databaseOptions: any,
  logger: Logger,
  metrics: Metrics,
  networkIdentifierOverride?: string,
): Promise<IndexerManagementClient> => {
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()

  // Spin up db
  let sequelize = await connectDatabase(databaseOptions)
  const queryFeeModels = defineQueryFeeModels(sequelize)
  const managementModels = defineIndexerManagementModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
  const statusEndpoint = 'http://127.0.0.1:8030/graphql'
  const graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
    'https://test-ipfs-endpoint.xyz',
    false, // disable auto-graft for tests
  )

  const networkSpecification = { ...testNetworkSpecification }

  const defaults: IndexerManagementDefaults = {
    globalIndexingRule: {
      allocationAmount: parseGRT('100'),
      parallelAllocations: 1,
      requireSupported: true,
      safety: true,
      protocolNetwork: 'arbitrum-sepolia',
    },
  }

  const network = await Network.create(
    logger,
    networkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
  )

  if (networkIdentifierOverride) {
    network.specification.networkIdentifier = networkIdentifierOverride
  }

  return await createIndexerManagementClient({
    models: managementModels,
    graphNode,
    logger,
    defaults,
    network,
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

export const queuedAllocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.ALLOCATE,
  deploymentID: subgraphDeployment1,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'arbitrum-sepolia',
} as ActionInput

export const invalidUnallocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.UNALLOCATE,
  allocationID: '0x8f63930129e585c69482b56390a09b6b176f4a4c',
  deploymentID: subgraphDeployment1,
  amount: undefined,
  poi: '0x0000000000000000000000000000000000000000000000000000000000000000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'arbitrum-sepolia',
} as ActionInput

export const invalidReallocateAction = {
  status: ActionStatus.QUEUED,
  type: ActionType.REALLOCATE,
  deploymentID: subgraphDeployment1,
  allocationID: '0x000009a610d8b4fd4d1e020e22cc55a623fe7d2a',
  poi: '0x0000000000000000000000000000000000000000000000000000000000000000',
  amount: undefined,
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'arbitrum-sepolia',
} as ActionInput
