import {
  DipsManager,
  GraphNode,
  IndexerManagementModels,
  Network,
  QueryFeeModels,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  SubgraphIdentifierType,
  IndexingDecisionBasis,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
} from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'
import { CollectPaymentStatus } from '@graphprotocol/dips-proto/generated/gateway'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

// Add these type declarations after the existing imports
let sequelize: Sequelize
let logger: Logger
let metrics: Metrics
let graphNode: GraphNode
let managementModels: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let network: Network

// Add mock implementation
jest.mock('../gateway-dips-service-client', () => ({
  ...jest.requireActual('../gateway-dips-service-client'),
  createGatewayDipsServiceClient: jest.fn(() => ({
    CancelAgreement: jest.fn().mockResolvedValue({}),
    CollectPayment: jest.fn().mockResolvedValue({
      status: CollectPaymentStatus.ACCEPT,
      tapReceipt: new Uint8Array(), // Mock tap receipt
    }),
  })),
}))

const setup = async () => {
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()

  graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
  )

  sequelize = await connectDatabase(__DATABASE__)
  managementModels = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  // Enable DIPs with all related configuration
  const networkSpecWithDips = {
    ...testNetworkSpecification,
    indexerOptions: {
      ...testNetworkSpecification.indexerOptions,
      enableDips: true,
      dipperEndpoint: 'https://test-dipper-endpoint.xyz',
      dipsAllocationAmount: parseGRT('1.0'), // Amount of GRT to allocate for DIPs
      dipsEpochsMargin: 1, // Optional: Number of epochs margin for DIPs
    },
  }

  network = await Network.create(
    logger,
    networkSpecWithDips,
    managementModels,
    queryFeeModels,
    graphNode,
    metrics,
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

describe('DipsManager', () => {
  beforeAll(setup)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  // We have been rate-limited on CI as this test uses RPC providers,
  // so we set its timeout to a higher value than usual.
  jest.setTimeout(30_000)

  describe('initialization', () => {
    test('creates DipsManager when dipperEndpoint is configured', () => {
      const dipsManager = new DipsManager(logger, managementModels, network, null)
      expect(dipsManager).toBeDefined()
    })

    test('throws error when dipperEndpoint is not configured', async () => {
      const specWithoutDipper = {
        ...testNetworkSpecification,
        indexerOptions: {
          ...testNetworkSpecification.indexerOptions,
          dipperEndpoint: undefined,
        },
      }
      const networkWithoutDipper = await Network.create(
        logger,
        specWithoutDipper,
        managementModels,
        queryFeeModels,
        graphNode,
        metrics,
      )
      expect(
        () => new DipsManager(logger, managementModels, networkWithoutDipper, null),
      ).toThrow('dipperEndpoint is not set')
    })
  })

  describe('agreement management', () => {
    let dipsManager: DipsManager
    const testDeploymentId = 'QmTest'
    const testAllocationId = '0x1234'
    const testAgreementId = 'agreement-1'

    beforeEach(async () => {
      // Clear mock calls between tests
      jest.clearAllMocks()

      dipsManager = new DipsManager(logger, managementModels, network, null)

      // Create a test agreement
      await managementModels.IndexingAgreement.create({
        id: testAgreementId,
        subgraph_deployment_id: testDeploymentId,
        current_allocation_id: testAllocationId,
        last_allocation_id: null,
        last_payment_collected_at: null,
        cancelled_at: null,
        min_epochs_per_collection: BigInt(1),
        max_epochs_per_collection: BigInt(5),
        payer: '0xabcd',
        signature: Buffer.from('1234', 'hex'),
        signed_payload: Buffer.from('5678', 'hex'),
        protocol_network: 'test',
        chain_id: '1',
        base_price_per_epoch: '100',
        price_per_entity: '1',
        service: '0xdeadbeef',
        payee: '0xdef0',
        deadline: new Date(Date.now() + 86400000), // 1 day from now
        duration_epochs: BigInt(10),
        max_initial_amount: '1000',
        max_ongoing_amount_per_epoch: '100',
        created_at: new Date(),
        updated_at: new Date(),
        signed_cancellation_payload: null,
      })
    })

    test('cancels agreement when allocation is closed', async () => {
      const mockClient = dipsManager.gatewayDipsServiceClient

      await dipsManager.tryCancelAgreement(testAllocationId)

      // Verify the client was called with correct parameters
      expect(mockClient.CancelAgreement).toHaveBeenCalledTimes(1)
      // TODO: Check the signed cancellation payload
      expect(mockClient.CancelAgreement).toHaveBeenCalledWith({
        version: 1,
        signedCancellation: expect.any(Uint8Array),
      })

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.cancelled_at).toBeDefined()
    })

    test('handles errors when cancelling agreement', async () => {
      const mockClient = dipsManager.gatewayDipsServiceClient
      ;(mockClient.CancelAgreement as jest.Mock).mockRejectedValueOnce(
        new Error('Failed to cancel'),
      )

      await dipsManager.tryCancelAgreement(testAllocationId)

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.cancelled_at).toBeNull()
    })

    test('updates agreement allocation IDs during reallocation', async () => {
      const newAllocationId = '0x5678'

      await dipsManager.tryUpdateAgreementAllocation(
        testDeploymentId,
        testAllocationId,
        newAllocationId,
      )

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.current_allocation_id).toBe(newAllocationId)
      expect(agreement?.last_allocation_id).toBe(testAllocationId)
      expect(agreement?.last_payment_collected_at).toBeNull()
    })

    test('creates indexing rules for active agreements', async () => {
      await dipsManager.ensureAgreementRules()

      const rules = await managementModels.IndexingRule.findAll({
        where: {
          identifier: testDeploymentId,
        },
      })

      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatchObject({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        allocationAmount:
          network.specification.indexerOptions.dipsAllocationAmount.toString(),
        autoRenewal: true,
        allocationLifetime: 4, // max_epochs_per_collection - dipsEpochsMargin
      })
    })

    test('returns active DIPs deployments', async () => {
      const deployments = await dipsManager.getActiveDipsDeployments()

      expect(deployments).toHaveLength(1)
      expect(deployments[0].ipfsHash).toBe(testDeploymentId)
    })
  })
})
