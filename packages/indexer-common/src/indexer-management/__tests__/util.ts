import {
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  IndexerManagementDefaults,
  loadTestYamlConfig,
  MultiNetworks,
  Network,
  specification,
} from '@graphprotocol/indexer-common'
import { connectDatabase, Metrics, Logger, parseGRT } from '@graphprotocol/common-ts'
import { createIndexerManagementYogaClient } from '../../indexer-management/yoga'
import { ActionInput, ActionStatus, ActionType } from '../../schema/types.generated'

const yamlObj = loadTestYamlConfig()
export const testNetworkSpecification: specification.NetworkSpecification =
  specification.NetworkSpecification.parse(yamlObj)

export async function createTestManagementClient(
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  databaseOptions: any,
  logger: Logger,
  injectDai: boolean,
  metrics: Metrics,
  networkIdentifierOverride?: string,
) {
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
  )

  const networkSpecification = { ...testNetworkSpecification }
  networkSpecification.dai.inject = injectDai

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

  const multiNetworks = new MultiNetworks(
    [network],
    (n: Network) => n.specification.networkIdentifier,
  )

  return await createIndexerManagementYogaClient({
    models: managementModels,
    graphNode,
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

export const queuedAllocateAction = {
  status: ActionStatus.queued,
  type: ActionType.allocate,
  deploymentID: subgraphDeployment1,
  amount: '10000',
  force: false,
  source: 'indexerAgent',
  reason: 'indexingRule',
  priority: 0,
  protocolNetwork: 'arbitrum-sepolia',
} as ActionInput

export const invalidUnallocateAction = {
  status: ActionStatus.queued,
  type: ActionType.unallocate,
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
  status: ActionStatus.queued,
  type: ActionType.reallocate,
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
