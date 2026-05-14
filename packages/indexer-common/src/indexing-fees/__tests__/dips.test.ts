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
  TapCollector,
  createIndexerManagementClient,
  Operator,
  ActionManager,
  IndexerManagementClient,
  MultiNetworks,
} from '@graphprotocol/indexer-common'
import type { SubgraphIndexingAgreement } from '../agreement-monitor'
import { definePendingRcaProposalModel } from '../../indexer-management/models/pending-rca-proposal'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'
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
let pendingRcaModel: ReturnType<typeof definePendingRcaProposalModel>
let network: Network
let multiNetworks: MultiNetworks<Network>
let indexerManagementClient: IndexerManagementClient
let operator: Operator
const networkSpecWithDips = {
  ...testNetworkSpecification,
  indexerOptions: {
    ...testNetworkSpecification.indexerOptions,
    enableDips: true,
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

const setCollectableAgreements = (agreements: SubgraphIndexingAgreement[]) => {
  network.indexingPaymentsSubgraph = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ data: { indexingAgreements: agreements } })
      .mockResolvedValueOnce({ data: { indexingAgreements: [] } }),
  } as unknown as Network['indexingPaymentsSubgraph']
}

jest.spyOn(TapCollector.prototype, 'startRAVProcessing').mockImplementation(() => {})
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
  pendingRcaModel = definePendingRcaProposalModel(sequelize)
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
    pendingRcaModel,
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
  setCollectableAgreements([])
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

  await pendingRcaModel.truncate({ cascade: true })
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
        pendingRcaModel,
      )

      dipsManager = new DipsManager(
        logger,
        managementModels,
        network,
        graphNode,
        allocationManager,
        pendingRcaModel,
      )
    })

    test('creates DIPS indexing rule for a pending RCA proposal', async () => {
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([
          {
            id: testAgreementId,
            status: 'pending',
            createdAt: new Date(),
            subgraphDeploymentId: new SubgraphDeploymentID(testDeploymentId),
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
            endsAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
            minSecondsPerCollection: 60,
            maxSecondsPerCollection: 3600,
            // Remaining fields are not consulted by ensureAgreementRules; cast to satisfy the type.
          } as never,
        ])
      setCollectableAgreements([])

      await dipsManager.ensureAgreementRules()

      const rules = await managementModels.IndexingRule.findAll({
        where: { identifier: testDeploymentId },
      })
      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatchObject({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.DIPS,
        autoRenewal: true,
        allocationLifetime: 3600, // max(min, max) seconds
      })
    })

    test('creates DIPS indexing rule for an active accepted agreement', async () => {
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([])
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

      const farFuture = String(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
      setCollectableAgreements([
        {
          id: testAgreementId,
          allocationId: testAllocationId,
          subgraphDeploymentId: testDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: farFuture,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
      ])

      await dipsManager.ensureAgreementRules()

      const rules = await managementModels.IndexingRule.findAll({
        where: { identifier: testDeploymentId },
      })
      expect(rules).toHaveLength(1)
      expect(rules[0].decisionBasis).toBe(IndexingDecisionBasis.DIPS)
      expect(rules[0].allocationLifetime).toBe(1800)
    })

    test('deduplicates when a deployment has both a pending proposal and an accepted agreement', async () => {
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([
          {
            id: 'pending-id',
            status: 'pending',
            createdAt: new Date(),
            subgraphDeploymentId: new SubgraphDeploymentID(testDeploymentId),
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
            endsAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
            minSecondsPerCollection: 60,
            maxSecondsPerCollection: 3600,
          } as never,
        ])
      const farFuture = String(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
      setCollectableAgreements([
        {
          id: testAgreementId,
          allocationId: testAllocationId,
          subgraphDeploymentId: testDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: farFuture,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
      ])
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

      await dipsManager.ensureAgreementRules()

      const rules = await managementModels.IndexingRule.findAll({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(rules).toHaveLength(1)
    })

    test('rejects pending proposal for a blocklisted deployment and creates no rule', async () => {
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.NEVER,
        protocolNetwork: 'eip155:421614',
      })

      const markRejected = jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'markRejected')
        .mockResolvedValue()
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([
          {
            id: testAgreementId,
            status: 'pending',
            createdAt: new Date(),
            subgraphDeploymentId: new SubgraphDeploymentID(testDeploymentId),
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
            endsAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
            minSecondsPerCollection: 60,
            maxSecondsPerCollection: 3600,
          } as never,
        ])
      setCollectableAgreements([])

      await dipsManager.ensureAgreementRules()

      expect(markRejected).toHaveBeenCalledWith(testAgreementId, 'deployment blocklisted')
      const dipsRules = await managementModels.IndexingRule.findAll({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(dipsRules).toHaveLength(0)
    })

    test('preserves a pre-existing non-DIPS rule (does not overwrite)', async () => {
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
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([
          {
            id: testAgreementId,
            status: 'pending',
            createdAt: new Date(),
            subgraphDeploymentId: new SubgraphDeploymentID(testDeploymentId),
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
            endsAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
            minSecondsPerCollection: 60,
            maxSecondsPerCollection: 3600,
          } as never,
        ])
      setCollectableAgreements([])

      await dipsManager.ensureAgreementRules()

      const rule = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
        },
      })
      expect(rule).not.toBeNull()
      expect(rule?.allocationLifetime).toBe(16)
    })

    test('returns deduped union of pending-proposal and active-agreement deployments', async () => {
      const otherDeploymentId = 'QmYBNHbqVgseAVKr3rJqkXMpwWa2zdrgJ2dKZTqtFhRzGV'
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([
          {
            id: 'pending-1',
            status: 'pending',
            createdAt: new Date(),
            subgraphDeploymentId: new SubgraphDeploymentID(testDeploymentId),
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
            endsAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
            minSecondsPerCollection: 60,
            maxSecondsPerCollection: 3600,
          } as never,
        ])
      const farFuture = String(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
      setCollectableAgreements([
        {
          id: testAgreementId,
          allocationId: testAllocationId,
          subgraphDeploymentId: otherDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: farFuture,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
        // Duplicate of the pending one — must dedupe.
        {
          id: 'agreement-2',
          allocationId: testAllocationId,
          subgraphDeploymentId: testDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: farFuture,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
      ])

      const deployments = await dipsManager.getActiveDipsDeployments()
      const ipfsHashes = deployments.map((d) => d.ipfsHash).sort()
      expect(ipfsHashes).toEqual([testDeploymentId, otherDeploymentId].sort())
    })

    test('removes DIPS rule whose deployment has neither pending proposal nor active agreement', async () => {
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.DIPS,
        protocolNetwork: 'eip155:421614',
        allocationLifetime: 3600,
      })
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([])
      setCollectableAgreements([])

      await dipsManager.ensureAgreementRules()

      const rule = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(rule).toBeNull()
    })

    test('keeps DIPS rule whose deployment is covered by an active accepted agreement', async () => {
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.DIPS,
        protocolNetwork: 'eip155:421614',
        allocationLifetime: 3600,
      })
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([])
      const farFuture = String(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
      setCollectableAgreements([
        {
          id: testAgreementId,
          allocationId: testAllocationId,
          subgraphDeploymentId: testDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: farFuture,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
      ])
      network.networkMonitor.subgraphDeployment = jest
        .fn()
        .mockResolvedValue(mockSubgraphDeployment(testDeploymentId))

      await dipsManager.ensureAgreementRules()

      const rule = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(rule).not.toBeNull()
    })

    test('treats agreement past endsAt as not active and removes its DIPS rule', async () => {
      await managementModels.IndexingRule.create({
        identifier: testDeploymentId,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: IndexingDecisionBasis.DIPS,
        protocolNetwork: 'eip155:421614',
        allocationLifetime: 3600,
      })
      jest
        .spyOn(dipsManager.pendingRcaConsumer!, 'getPendingProposals')
        .mockResolvedValue([])
      const past = String(Math.floor(Date.now() / 1000) - 60)
      setCollectableAgreements([
        {
          id: testAgreementId,
          allocationId: testAllocationId,
          subgraphDeploymentId: testDeploymentId,
          state: 'Accepted',
          lastCollectionAt: '0',
          endsAt: past,
          maxInitialTokens: '0',
          maxOngoingTokensPerSecond: '0',
          tokensPerSecond: '0',
          tokensPerEntityPerSecond: '0',
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 1800,
          canceledAt: '0',
        },
      ])

      await dipsManager.ensureAgreementRules()

      const rule = await managementModels.IndexingRule.findOne({
        where: {
          identifier: testDeploymentId,
          decisionBasis: IndexingDecisionBasis.DIPS,
        },
      })
      expect(rule).toBeNull()
    })

    describe('cancelAgreement', () => {
      const mockAgreement: SubgraphIndexingAgreement = {
        id: '0x123e4567e89b12d3a456426614174000',
        allocationId: '0xabcd47df40c29949a75a6693c77834c00b8ad626',
        subgraphDeploymentId: 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7',
        state: 'Accepted',
        lastCollectionAt: '0',
        endsAt: '9999999999',
        maxInitialTokens: '1000',
        maxOngoingTokensPerSecond: '100',
        tokensPerSecond: '10',
        tokensPerEntityPerSecond: '1',
        minSecondsPerCollection: 60,
        maxSecondsPerCollection: 300,
        canceledAt: '0',
      }

      beforeEach(() => {
        // Track the agreement so we can verify cleanup
        dipsManager.collectionTracker.track(mockAgreement.id, {
          lastCollectedAt: 0,
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 300,
        })
      })

      test('successful cancel + final collect attempt', async () => {
        const mockReceipt = { hash: '0xcancel123' }
        const mockCollectReceipt = { hash: '0xcollect456' }

        // Mock cancel transaction
        network.transactionManager.executeTransaction = jest
          .fn()
          .mockResolvedValueOnce(mockReceipt) // cancel
          .mockResolvedValueOnce(mockCollectReceipt) // collect

        // Mock block number and graph node methods for collect
        network.networkProvider.getBlockNumber = jest.fn().mockResolvedValue(100)
        graphNode.entityCount = jest.fn().mockResolvedValue([250000])
        graphNode.subgraphFeatures = jest.fn().mockResolvedValue({ network: 'mainnet' })
        graphNode.blockHashFromNumber = jest.fn().mockResolvedValue('0xblockhash')
        graphNode.proofOfIndexing = jest
          .fn()
          .mockResolvedValue(
            '0x0000000000000000000000000000000000000000000000000000000000000001',
          )

        const result = await dipsManager.cancelAgreement(mockAgreement.id, mockAgreement)

        expect(result).toBe(true)
        // executeTransaction called twice: once for cancel, once for collect
        expect(network.transactionManager.executeTransaction).toHaveBeenCalledTimes(2)
        // Tracker should be cleaned up (untracked = ready)
        expect(
          dipsManager.collectionTracker.isReadyForCollection(mockAgreement.id, 0),
        ).toBe(true)
      })

      test('cancel fails returns false, no collect attempted', async () => {
        // Mock cancel transaction failure
        network.transactionManager.executeTransaction = jest
          .fn()
          .mockRejectedValueOnce(new Error('cancel tx reverted'))

        const result = await dipsManager.cancelAgreement(mockAgreement.id, mockAgreement)

        expect(result).toBe(false)
        // executeTransaction called only once (for cancel)
        expect(network.transactionManager.executeTransaction).toHaveBeenCalledTimes(1)
      })

      test('cancel succeeds but collect fails returns true, tracker still cleaned up', async () => {
        const mockReceipt = { hash: '0xcancel123' }

        // Mock cancel succeeds
        network.transactionManager.executeTransaction = jest
          .fn()
          .mockResolvedValueOnce(mockReceipt) // cancel succeeds
          .mockRejectedValueOnce(new Error('collect failed')) // collect fails

        // Mock block number and graph node methods
        network.networkProvider.getBlockNumber = jest.fn().mockResolvedValue(100)
        graphNode.entityCount = jest.fn().mockResolvedValue([250000])
        graphNode.subgraphFeatures = jest.fn().mockResolvedValue({ network: 'mainnet' })
        graphNode.blockHashFromNumber = jest.fn().mockResolvedValue('0xblockhash')
        graphNode.proofOfIndexing = jest
          .fn()
          .mockResolvedValue(
            '0x0000000000000000000000000000000000000000000000000000000000000001',
          )

        const result = await dipsManager.cancelAgreement(mockAgreement.id, mockAgreement)

        expect(result).toBe(true)
        // Tracker should be cleaned up even though collect failed
        expect(
          dipsManager.collectionTracker.isReadyForCollection(mockAgreement.id, 0),
        ).toBe(true)
      })
    })

    describe('cleanupFinishedAgreement', () => {
      const baseAgreement: SubgraphIndexingAgreement = {
        id: '0x123e4567e89b12d3a456426614174000',
        allocationId: '0xabcd47df40c29949a75a6693c77834c00b8ad626',
        subgraphDeploymentId: 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7',
        state: 'Accepted',
        lastCollectionAt: '0',
        endsAt: '9999999999',
        maxInitialTokens: '1000',
        maxOngoingTokensPerSecond: '100',
        tokensPerSecond: '10',
        tokensPerEntityPerSecond: '1',
        minSecondsPerCollection: 60,
        maxSecondsPerCollection: 300,
        canceledAt: '0',
      }

      beforeEach(() => {
        dipsManager.collectionTracker.track(baseAgreement.id, {
          lastCollectedAt: 0,
          minSecondsPerCollection: 60,
          maxSecondsPerCollection: 300,
        })
      })

      test('removes payer-cancelled agreement from tracker after collection', () => {
        const removeSpy = jest.spyOn(dipsManager.collectionTracker, 'remove')
        const agreement = { ...baseAgreement, state: 'CanceledByPayer' as const }

        const result = dipsManager.cleanupFinishedAgreement(agreement, 1000, logger)

        expect(result).toBe(true)
        expect(removeSpy).toHaveBeenCalledWith(agreement.id)
      })

      test('removes expired agreement from tracker after collection', () => {
        const removeSpy = jest.spyOn(dipsManager.collectionTracker, 'remove')
        const nowSeconds = 2000
        const agreement = { ...baseAgreement, state: 'Accepted' as const, endsAt: '1000' }

        const result = dipsManager.cleanupFinishedAgreement(agreement, nowSeconds, logger)

        expect(result).toBe(true)
        expect(removeSpy).toHaveBeenCalledWith(agreement.id)
      })

      test('does not remove active agreement from tracker', () => {
        const removeSpy = jest.spyOn(dipsManager.collectionTracker, 'remove')
        const nowSeconds = 1000
        const agreement = {
          ...baseAgreement,
          state: 'Accepted' as const,
          endsAt: '9999999999',
        }

        const result = dipsManager.cleanupFinishedAgreement(agreement, nowSeconds, logger)

        expect(result).toBe(false)
        expect(removeSpy).not.toHaveBeenCalled()
      })
    })

    describe('cancelBlocklistedAgreements', () => {
      const mockAgreement: SubgraphIndexingAgreement = {
        id: '0x123e4567e89b12d3a456426614174000',
        allocationId: '0xabcd47df40c29949a75a6693c77834c00b8ad626',
        subgraphDeploymentId: 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7',
        state: 'Accepted',
        lastCollectionAt: '0',
        endsAt: '9999999999',
        maxInitialTokens: '1000',
        maxOngoingTokensPerSecond: '100',
        tokensPerSecond: '10',
        tokensPerEntityPerSecond: '1',
        minSecondsPerCollection: 60,
        maxSecondsPerCollection: 300,
        canceledAt: '0',
      }

      test('cancels agreements with NEVER rule for their deployment', async () => {
        // Create a NEVER rule for the test deployment
        await managementModels.IndexingRule.create({
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.NEVER,
          requireSupported: true,
          safety: true,
          protocolNetwork: 'eip155:421614',
          allocationAmount: '0',
        })

        const cancelSpy = jest
          .spyOn(dipsManager, 'cancelAgreement')
          .mockResolvedValue(true)

        await dipsManager.cancelBlocklistedAgreements([mockAgreement])

        expect(cancelSpy).toHaveBeenCalledTimes(1)
        expect(cancelSpy).toHaveBeenCalledWith(mockAgreement.id, mockAgreement)
      })

      test('cancels agreements with OFFCHAIN rule for their deployment', async () => {
        await managementModels.IndexingRule.create({
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.OFFCHAIN,
          requireSupported: true,
          safety: true,
          protocolNetwork: 'eip155:421614',
          allocationAmount: '0',
        })

        const cancelSpy = jest
          .spyOn(dipsManager, 'cancelAgreement')
          .mockResolvedValue(true)

        await dipsManager.cancelBlocklistedAgreements([mockAgreement])

        expect(cancelSpy).toHaveBeenCalledTimes(1)
        expect(cancelSpy).toHaveBeenCalledWith(mockAgreement.id, mockAgreement)
      })

      test('does not cancel agreements without NEVER or OFFCHAIN rule', async () => {
        const cancelSpy = jest
          .spyOn(dipsManager, 'cancelAgreement')
          .mockResolvedValue(true)

        await dipsManager.cancelBlocklistedAgreements([mockAgreement])

        expect(cancelSpy).not.toHaveBeenCalled()
      })

      test('skips CanceledByPayer agreements even when a NEVER rule exists', async () => {
        // Reproduces the bug where the payer canceled on-chain first
        // (via dipper) and the agent's own NEVER rule for the closed
        // allocation would otherwise route the agreement back through
        // cancelAgreement, which would attempt a redundant on-chain
        // cancel and skip the final collection.
        await managementModels.IndexingRule.create({
          identifier: testDeploymentId,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.NEVER,
          requireSupported: true,
          safety: true,
          protocolNetwork: 'eip155:421614',
          allocationAmount: '0',
        })

        const cancelSpy = jest
          .spyOn(dipsManager, 'cancelAgreement')
          .mockResolvedValue(true)

        const canceledByPayer: SubgraphIndexingAgreement = {
          ...mockAgreement,
          state: 'CanceledByPayer',
        }

        await dipsManager.cancelBlocklistedAgreements([canceledByPayer])

        expect(cancelSpy).not.toHaveBeenCalled()
      })
    })

    describe('cancelAgreement', () => {
      const mockAgreement: SubgraphIndexingAgreement = {
        id: '0x123e4567e89b12d3a456426614174000',
        allocationId: '0xabcd47df40c29949a75a6693c77834c00b8ad626',
        subgraphDeploymentId: 'QmTZ8ejXJxRo7vDBS4uwqBeGoxLSWbhaA7oXa1RvxunLy7',
        state: 'Accepted',
        lastCollectionAt: '0',
        endsAt: '9999999999',
        maxInitialTokens: '1000',
        maxOngoingTokensPerSecond: '100',
        tokensPerSecond: '10',
        tokensPerEntityPerSecond: '1',
        minSecondsPerCollection: 60,
        maxSecondsPerCollection: 300,
        canceledAt: '0',
      }

      test('skips on-chain cancel for CanceledByPayer agreements and still calls final collect', async () => {
        // Defense-in-depth for the case where any caller passes an
        // already-canceled agreement: skip the doomed on-chain cancel,
        // proceed to the final collect so the indexer gets paid for the
        // period the agreement was active.
        const cancelCallSpy = jest.fn()
        ;(
          dipsManager as unknown as {
            network: {
              contracts: { SubgraphService: { cancelIndexingAgreement: jest.Mock } }
            }
          }
        ).network.contracts.SubgraphService = {
          cancelIndexingAgreement: cancelCallSpy,
        } as never

        const tryCollectSpy = jest
          .spyOn(
            dipsManager as unknown as { tryCollectAgreement: jest.Mock },
            'tryCollectAgreement',
          )
          .mockResolvedValue('collected')

        ;(
          dipsManager as unknown as {
            network: { networkProvider: { getBlockNumber: jest.Mock } }
          }
        ).network.networkProvider = {
          getBlockNumber: jest.fn().mockResolvedValue(123),
        } as never

        const canceledByPayer: SubgraphIndexingAgreement = {
          ...mockAgreement,
          state: 'CanceledByPayer',
        }

        const result = await dipsManager.cancelAgreement(
          canceledByPayer.id,
          canceledByPayer,
        )

        expect(cancelCallSpy).not.toHaveBeenCalled()
        expect(tryCollectSpy).toHaveBeenCalledTimes(1)
        expect(result).toBe(true)
      })
    })
  })
})
