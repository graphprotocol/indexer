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
  AllocationManager,
  DipsCollector,
  TapCollector,
  createIndexerManagementClient,
  Operator,
  ActionManager,
  IndexerManagementClient,
  MultiNetworks,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { CollectPaymentStatus } from '@graphprotocol/dips-proto/generated/gateway'

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
let multiNetworks: MultiNetworks<Network>
let dipsCollector: DipsCollector
let indexerManagementClient: IndexerManagementClient
let operator: Operator
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

const mockSubgraphDeployment = (id: string) => {
  return {
    id: new SubgraphDeploymentID(id),
    ipfsHash: id,
    deniedAt: null,
    stakedTokens: 1000n,
    signalledTokens: 1000n,
    queryFeesAmount: 0n,
    protocolNetwork: 'eip155:421614',
  }
}

jest.spyOn(TapCollector.prototype, 'startRAVProcessing').mockImplementation(() => {})
const startCollectionLoop = jest
  .spyOn(DipsCollector.prototype, 'startCollectionLoop')
  .mockImplementation(() => {})
jest.spyOn(ActionManager.prototype, 'monitorQueue').mockImplementation(async () => {})
const setup = async () => {
  logger = createLogger({
    name: 'DIPs Test Logger',
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
    'https://test-ipfs-endpoint.xyz',
  )

  sequelize = await connectDatabase(__DATABASE__)
  managementModels = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  network = await Network.create(
    logger,
    networkSpecWithDips,
    managementModels,
    queryFeeModels,
    graphNode,
    metrics,
  )

  multiNetworks = new MultiNetworks(
    [network],
    (n: Network) => n.specification.networkIdentifier,
  )

  dipsCollector = network.dipsCollector!
  indexerManagementClient = await createIndexerManagementClient({
    models: managementModels,
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

  operator = new Operator(logger, indexerManagementClient, networkSpecWithDips)
}

const ensureGlobalIndexingRule = async () => {
  await operator.ensureGlobalIndexingRule()
  logger.debug('Ensured global indexing rule')
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
  await ensureGlobalIndexingRule()
}

const teardownEach = async () => {
  // Clear out query fee model tables
  await queryFeeModels.allocationReceipts.truncate({ cascade: true })
  await queryFeeModels.vouchers.truncate({ cascade: true })
  await queryFeeModels.transferReceipts.truncate({ cascade: true })
  await queryFeeModels.transfers.truncate({ cascade: true })
  await queryFeeModels.allocationSummaries.truncate({ cascade: true })
  await queryFeeModels.scalarTapReceipts.truncate({ cascade: true })

  // Clear out indexer management models
  await managementModels.Action.truncate({ cascade: true })
  await managementModels.CostModel.truncate({ cascade: true })
  await managementModels.IndexingRule.truncate({ cascade: true })
  await managementModels.POIDispute.truncate({ cascade: true })

  // Clear out indexing agreement model
  await managementModels.IndexingAgreement.truncate({ cascade: true })
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

      metrics.registry.clear()
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
    const testDeploymentId = 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7'
    const testAllocationId = 'abcd47df40c29949a75a6693c77834c00b8ad626'
    const testAgreementId = '123e4567-e89b-12d3-a456-426614174000'

    beforeEach(async () => {
      // Clear mock calls between tests
      jest.clearAllMocks()

      const allocationManager = new AllocationManager(
        logger,
        managementModels,
        graphNode,
        network,
      )

      dipsManager = new DipsManager(logger, managementModels, network, allocationManager)

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
        payer: '123456df40c29949a75a6693c77834c00b8a5678',
        signature: Buffer.from('1234', 'hex'),
        signed_payload: Buffer.from('5678', 'hex'),
        protocol_network: 'arbitrum-sepolia',
        chain_id: 'eip155:1',
        base_price_per_epoch: '100',
        price_per_entity: '1',
        service: 'deadbedf40c29949a75a2293c11834c00b8a1234',
        payee: '1212564f40c29949a75a3423c11834c00b8aaaaa',
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
      const client = dipsManager.gatewayDipsServiceClient

      client.CancelAgreement = jest.fn().mockResolvedValue({})

      await dipsManager.tryCancelAgreement(testAllocationId)

      // Verify the client was called with correct parameters
      expect((client.CancelAgreement as jest.Mock).mock.calls.length).toBe(1)
      // TODO: Check the signed cancellation payload
      expect((client.CancelAgreement as jest.Mock).mock.calls[0][0]).toEqual({
        version: 1,
        signedCancellation: expect.any(Uint8Array),
      })

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.cancelled_at).toBeDefined()
    })

    test('handles errors when cancelling agreement', async () => {
      const client = dipsManager.gatewayDipsServiceClient
      client.CancelAgreement = jest
        .fn()
        .mockRejectedValueOnce(new Error('Failed to cancel'))

      await dipsManager.tryCancelAgreement(testAllocationId)

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.cancelled_at).toBeNull()
    })

    test('updates agreement allocation IDs during reallocation', async () => {
      const newAllocationId = '5678bedf40c29945678a2293c15678c00b8a5678'

      await dipsManager.tryUpdateAgreementAllocation(
        testDeploymentId,
        toAddress(testAllocationId),
        toAddress(newAllocationId),
      )

      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      expect(agreement?.current_allocation_id).toBe(toAddress(newAllocationId))
      expect(agreement?.last_allocation_id).toBe(toAddress(testAllocationId))
      expect(agreement?.last_payment_collected_at).toBeNull()
    })

    test('creates indexing rules for active agreements', async () => {
      // Mock fetch the subgraph deployment from the network subgraph
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

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
        decisionBasis: IndexingDecisionBasis.DIPS,
        allocationAmount:
          network.specification.indexerOptions.dipsAllocationAmount.toString(),
        autoRenewal: true,
        allocationLifetime: 4, // max_epochs_per_collection - dipsEpochsMargin
      })
    })

    test('does not create or modify an indexing rule if it already exists', async () => {
      // Create an indexing rule with the same identifier
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        allocationLifetime: 16,
        requireSupported: true,
        safety: true,
        protocolNetwork: 'eip155:421614',
        allocationAmount: '1030',
      })

      // Mock fetch the subgraph deployment from the network subgraph
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

      await dipsManager.ensureAgreementRules()

      const rules = await managementModels.IndexingRule.findAll({
        where: { identifier: testDeploymentId },
      })
      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatchObject({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        allocationLifetime: 16,
        requireSupported: true,
        safety: true,
        protocolNetwork: 'eip155:421614',
        allocationAmount: '1030',
      })
    })

    test('removes DIPs indexing rule for cancelled agreement', async () => {
      await dipsManager.ensureAgreementRules()
      const rule = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(rule).toBeDefined()
      await managementModels.IndexingAgreement.update(
        {
          cancelled_at: new Date(),
        },
        {
          where: { id: testAgreementId },
        },
      )
      await dipsManager.ensureAgreementRules()
      const ruleAfter = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(ruleAfter).toBeNull()
    })

    test('does not remove pre-existing non-DIPS indexing rule', async () => {
      // Create an indexing rule with the same identifier
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.ALWAYS,
        allocationLifetime: 16,
        requireSupported: true,
        safety: true,
        protocolNetwork: 'eip155:421614',
        allocationAmount: '1030',
      })
      await dipsManager.ensureAgreementRules()
      const ruleBefore = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
        },
      })
      expect(ruleBefore).toBeDefined()
      await managementModels.IndexingAgreement.update(
        {
          cancelled_at: new Date(),
        },
        {
          where: { id: testAgreementId },
        },
      )
      await dipsManager.ensureAgreementRules()
      const ruleAfter = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
        },
      })
      expect(ruleAfter).toBeDefined()
    })

    test('returns active DIPs deployments', async () => {
      const deployments = await dipsManager.getActiveDipsDeployments()

      expect(deployments).toHaveLength(1)
      expect(deployments[0].ipfsHash).toBe(testDeploymentId)
    })
  })
})

describe('DipsCollector', () => {
  beforeAll(setup)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  describe('initialization', () => {
    test('creates DipsCollector when dipperEndpoint is configured', () => {
      const dipsCollector = new DipsCollector(
        logger,
        managementModels,
        queryFeeModels,
        networkSpecWithDips,
        network.tapCollector!,
        network.wallet,
        graphNode,
        jest.fn(),
      )
      expect(dipsCollector).toBeDefined()
    })
    test('starts payment collection loop', () => {
      const dipsCollector = new DipsCollector(
        logger,
        managementModels,
        queryFeeModels,
        networkSpecWithDips,
        network.tapCollector!,
        network.wallet,
        graphNode,
        jest.fn(),
      )
      expect(dipsCollector).toBeDefined()
      expect(startCollectionLoop).toHaveBeenCalled()
    })
    test('throws error when dipperEndpoint is not configured', () => {
      const specWithoutDipper = {
        ...testNetworkSpecification,
        indexerOptions: {
          ...testNetworkSpecification.indexerOptions,
          dipperEndpoint: undefined,
        },
      }
      expect(
        () =>
          new DipsCollector(
            logger,
            managementModels,
            queryFeeModels,
            specWithoutDipper,
            network.tapCollector!,
            network.wallet,
            graphNode,
            jest.fn(),
          ),
      ).toThrow('dipperEndpoint is not set')
    })
  })

  describe('payment collection', () => {
    const testDeploymentId = 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7'
    const testAllocationId = 'abcd47df40c29949a75a6693c77834c00b8ad626'
    const testAgreementId = '123e4567-e89b-12d3-a456-426614174000'

    beforeEach(async () => {
      // Clear mock calls between tests
      jest.clearAllMocks()

      // Create a test agreement
      // Note last_allocation_id is set to the testAllocationId
      // current_allocation_id is set to null so that we can collect payment
      // (also last_payment_collected_at is set to null)
      await managementModels.IndexingAgreement.create({
        id: testAgreementId,
        subgraph_deployment_id: testDeploymentId,
        current_allocation_id: null,
        last_allocation_id: testAllocationId,
        last_payment_collected_at: null,
        cancelled_at: null,
        min_epochs_per_collection: BigInt(1),
        max_epochs_per_collection: BigInt(5),
        payer: '123456df40c29949a75a6693c77834c00b8a5678',
        signature: Buffer.from('1234', 'hex'),
        signed_payload: Buffer.from('5678', 'hex'),
        protocol_network: 'arbitrum-sepolia',
        chain_id: 'eip155:1',
        base_price_per_epoch: '100',
        price_per_entity: '1',
        service: 'deadbedf40c29949a75a2293c11834c00b8a1234',
        payee: '1212564f40c29949a75a3423c11834c00b8aaaaa',
        deadline: new Date(Date.now() + 86400000), // 1 day from now
        duration_epochs: BigInt(10),
        max_initial_amount: '1000',
        max_ongoing_amount_per_epoch: '100',
        created_at: new Date(),
        updated_at: new Date(),
        signed_cancellation_payload: null,
      })
      graphNode.entityCount = jest.fn().mockResolvedValue([250000])
    })
    test('collects payment for a specific agreement', async () => {
      const agreement = await managementModels.IndexingAgreement.findOne({
        where: { id: testAgreementId },
      })
      if (!agreement) {
        throw new Error('Agreement not found')
      }

      const client = dipsCollector.gatewayDipsServiceClient

      client.CollectPayment = jest.fn().mockResolvedValue({
        version: 1,
        status: CollectPaymentStatus.ACCEPT,
        tapReceipt: Buffer.from('1234', 'hex'),
      })
      dipsCollector.gatewayDipsServiceMessagesCodec.decodeTapReceipt = jest
        .fn()
        .mockImplementation(() => {
          logger.info('MOCK Decoding TAP receipt')
          return {
            allocation_id: toAddress(testAllocationId),
            signer_address: toAddress('0xabcd56df41234949a75a6693c77834c00b8abbbb'),
            signature: Buffer.from('1234', 'hex'),
            timestamp_ns: 1234567890,
            nonce: 1,
            value: '1000',
          }
        })
      dipsCollector.escrowSenderGetter = jest.fn().mockImplementation(() => {
        logger.info('MOCK Getting escrow sender for signer')
        return toAddress('0x123456df40c29949a75a6693c77834c00b8a5678')
      })

      await dipsCollector.tryCollectPayment(agreement)

      expect(client.CollectPayment).toHaveBeenCalledWith({
        version: 1,
        signedCollection: expect.any(Uint8Array),
      })
      expect(agreement.last_payment_collected_at).not.toBeNull()

      const receipt = await queryFeeModels.scalarTapReceipts.findOne({
        where: {
          allocation_id: testAllocationId,
        },
      })
      expect(receipt).not.toBeNull()
      expect(receipt?.signer_address).toBe(
        toAddress('0xabcd56df41234949a75a6693c77834c00b8abbbb'),
      )
      expect(receipt?.value).toBe('1000')
    })
  })
})
