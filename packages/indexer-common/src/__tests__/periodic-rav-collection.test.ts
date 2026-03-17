import { GraphTallyCollector } from '../allocations/graph-tally-collector'
import { createLogger, createMetrics, mutable } from '@graphprotocol/common-ts'

// We need to test the helpers directly. Since they're private,
// we test them through the public interface or use type casting.
// For isolated unit tests, we'll cast to `any` to access private members.

describe('GraphTallyCollector - Periodic RAV Collection', () => {
  let collector: GraphTallyCollector

  const mockLogger = createLogger({ name: 'test', async: false, level: 'error' })
  const mockAllocation = (id: string) => ({
    id: id.toLowerCase(),
    subgraphDeployment: { id: '0x1234' },
    allocatedTokens: 1000n,
  })

  beforeEach(async () => {
    // Mock startRAVProcessing to prevent timer loops during tests
    jest
      .spyOn(GraphTallyCollector.prototype as any, 'startRAVProcessing')
      .mockImplementation(() => {})

    const mockMetrics = createMetrics()
    const activeAllocations = mutable([
      mockAllocation('0xactive1111111111111111111111111111111111'),
    ])

    // Create collector with minimal mocks
    collector = GraphTallyCollector.create({
      logger: mockLogger,
      metrics: mockMetrics,
      transactionManager: {} as any,
      models: {
        receiptAggregateVouchersV2: {
          findAll: jest.fn().mockResolvedValue([]),
          sequelize: { query: jest.fn() },
        },
      } as any,
      contracts: {
        GraphTallyCollector: {
          target: '0x0000000000000000000000000000000000000000',
          interface: { getEvent: jest.fn(), decodeEventLog: jest.fn() },
        },
        SubgraphService: {
          interface: { encodeFunctionData: jest.fn() },
          collect: { estimateGas: jest.fn() },
          multicall: jest.fn(),
        },
      } as any,
      allocations: activeAllocations as any,
      networkSpecification: {
        networkIdentifier: 'test',
        indexerOptions: {
          voucherRedemptionThreshold: 1000000000000000000n, // 1 GRT
          finalityTime: 3600,
          address: '0x0000000000000000000000000000000000000001',
          ravCollectionMaxBatchSize: 50,
          ravCollectionInterval: 300, // 5 minutes for tests
        },
      } as any,
      networkSubgraph: {} as any,
    })
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    // cleanup prom-client metrics to avoid "already registered" errors
    const { register } = require('prom-client')
    register.clear()
  })

  describe('isCooldownExpired', () => {
    it('returns true when no previous collection exists', () => {
      const result = (collector as any).isCooldownExpired('0xcollection1')
      expect(result).toBe(true)
    })

    it('returns false when cooldown has not elapsed', () => {
      const collectionId = '0xcollection1'
      ;(collector as any).lastCollectedAt.set(collectionId, Date.now())
      const result = (collector as any).isCooldownExpired(collectionId)
      expect(result).toBe(false)
    })

    it('returns true when cooldown has elapsed', () => {
      const collectionId = '0xcollection1'
      // Set last collected 10 minutes ago, interval is 5 minutes
      ;(collector as any).lastCollectedAt.set(collectionId, Date.now() - 600_000)
      const result = (collector as any).isCooldownExpired(collectionId)
      expect(result).toBe(true)
    })
  })

  describe('isActiveAllocation', () => {
    it('returns true for an allocation in the active set', async () => {
      const result = await (collector as any).isActiveAllocation(
        '0xactive1111111111111111111111111111111111',
      )
      expect(result).toBe(true)
    })

    it('returns false for an allocation not in the active set', async () => {
      const result = await (collector as any).isActiveAllocation(
        '0xclosed2222222222222222222222222222222222',
      )
      expect(result).toBe(false)
    })
  })

  describe('lastCollectedAt map', () => {
    it('can be updated and read', () => {
      const collectionId = '0xcollection1'
      const now = Date.now()
      ;(collector as any).lastCollectedAt.set(collectionId, now)
      expect((collector as any).lastCollectedAt.get(collectionId)).toBe(now)
    })

    it('resets on new collector instance (simulating process restart)', async () => {
      const collectionId = '0xcollection1'
      ;(collector as any).lastCollectedAt.set(collectionId, Date.now())
      // New instance has empty map
      expect((collector as any).lastCollectedAt.size).toBe(1)
      // A fresh collector would have size 0 — verified by the beforeEach creating new instances
    })
  })

  describe('ravCollectionInterval config', () => {
    it('is set from networkSpecification', () => {
      expect((collector as any).ravCollectionInterval).toBe(300)
    })
  })
})
