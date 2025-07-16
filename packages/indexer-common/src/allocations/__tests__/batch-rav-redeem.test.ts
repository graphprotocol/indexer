import {
  defineQueryFeeModels,
  GraphNode,
  Network,
  QueryFeeModels,
  TapSubgraphResponse,
  TapCollector,
  Allocation,
  ReceiptAggregateVoucher,
} from '@graphprotocol/indexer-common'
import {
  Address,
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  toAddress,
} from '@graphprotocol/common-ts'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { Sequelize } from 'sequelize'
import { utils, ethers } from 'ethers'

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

// Test addresses
const ALLOCATION_ID_1 = toAddress('edde47df40c29949a75a6693c77834c00b8ad626')
const ALLOCATION_ID_2 = toAddress('dead47df40c29949a75a6693c77834c00b8ad624')
const ALLOCATION_ID_3 = toAddress('6aea8894b5ab5a36cdc2d8be9290046801dd5fed')
const ALLOCATION_ID_4 = toAddress('abcd8894b5ab5a36cdc2d8be9290046801dd5fed')
const ALLOCATION_ID_5 = toAddress('12348894b5ab5a36cdc2d8be9290046801dd5fed')

const SENDER_ADDRESS_1 = toAddress('ffcf8fdee72ac11b5c542428b35eef5769c409f0')
const SENDER_ADDRESS_2 = toAddress('dead47df40c29949a75a6693c77834c00b8ad624')

const SIGNATURE = Buffer.from(
  'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
  'hex',
)

const setup = async () => {
  logger = createLogger({
    name: 'Indexer Batch RAV Test',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()
  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
    'https://test-ipfs-endpoint.xyz',
  )

  // Create network specification with batch RAV configuration
  const batchNetworkSpec = {
    ...testNetworkSpecification,
    indexerOptions: {
      ...testNetworkSpecification.indexerOptions,
      // Enable batching for tests
      ravRedemptionBatchSize: 3,
      ravRedemptionBatchThreshold: utils.parseUnits('30', 18),
      ravRedemptionMaxBatchSize: 5,
    },
  }

  const network = await Network.create(
    logger,
    batchNetworkSpec,
    queryFeeModels,
    graphNode,
    metrics,
  )
  tapCollector = network.tapCollector!
}

const createRAV = (
  allocationId: Address,
  senderAddress: Address,
  value: bigint,
  last = true,
  final = false,
  redeemedAt: Date | null = null,
) => {
  return {
    allocationId,
    last,
    final,
    timestampNs: 1709067401177959664n,
    valueAggregate: value,
    signature: SIGNATURE,
    senderAddress,
    redeemedAt,
  }
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })

  // Mock findTransactionsForRavs to return empty transactions
  jest
    .spyOn(tapCollector, 'findTransactionsForRavs')
    .mockImplementation(async (): Promise<TapSubgraphResponse> => {
      return {
        transactions: [],
        _meta: {
          block: {
            timestamp: Date.now(),
            hash: 'test-hash',
          },
        },
      }
    })
}

const teardownEach = async () => {
  // Clear out query fee model tables
  await queryFeeModels.receiptAggregateVouchers.truncate({ cascade: true })
  jest.clearAllMocks()
}

const teardownAll = async () => {
  await sequelize.drop({})
}

describe('Batch RAV Redemption', () => {
  beforeAll(setup, timeout)
  beforeEach(setupEach, timeout)
  afterEach(teardownEach, timeout)
  afterAll(teardownAll, timeout)

  describe('Multicall3 initialization', () => {
    test('should initialize Multicall3 contract', async () => {
      const initSpy = jest.spyOn(
        tapCollector as unknown as { initializeMulticall3: () => Promise<void> },
        'initializeMulticall3',
      )
      await tapCollector['initializeMulticall3']()

      expect(initSpy).toHaveBeenCalled()
      expect(tapCollector['multicall3']).toBeDefined()
    })

    test('should handle missing Multicall3 gracefully', async () => {
      // Mock provider to simulate no code at Multicall3 address
      const mockProvider = {
        getCode: jest.fn().mockResolvedValue('0x'),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(tapCollector as any)['protocolNetwork'].provider =
        mockProvider as unknown as ethers.providers.JsonRpcProvider

      await tapCollector['initializeMulticall3']()

      expect(tapCollector['multicall3']).toBeNull()
      expect(mockProvider.getCode).toHaveBeenCalledWith(
        '0xcA11bde05977b3631167028862bE2a173976CA11',
      )
    })
  })

  describe('Batch formation logic', () => {
    test('should form batches based on size and threshold', async () => {
      // Create 5 RAVs with different values
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_3,
          SENDER_ADDRESS_1,
          utils.parseUnits('10', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_4,
          SENDER_ADDRESS_1,
          utils.parseUnits('25', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_5,
          SENDER_ADDRESS_1,
          utils.parseUnits('5', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batches = await (tapCollector as any)['submitRAVsInBatches'](
        signedRavs,
        {},
        logger,
      )

      // Should create 2 batches:
      // Batch 1: First 3 RAVs (15 + 20 + 10 = 45 GRT) - meets size and threshold
      // Batch 2: Last 2 RAVs (25 + 5 = 30 GRT) - meets threshold
      expect(batches).toHaveLength(2)
      expect(batches[0]).toHaveLength(3)
      expect(batches[1]).toHaveLength(2)
    })

    test('should respect max batch size', async () => {
      // Create 7 RAVs (more than max batch size of 5)
      const ravs: ReturnType<typeof createRAV>[] = []
      for (let i = 0; i < 7; i++) {
        ravs.push(
          createRAV(
            toAddress(`dead47df40c29949a75a6693c77834c00b8ad62${i}`),
            SENDER_ADDRESS_1,
            utils.parseUnits('20', 18).toBigInt(),
          ),
        )
      }

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('200', 18).toBigInt()),
        })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batches = await (tapCollector as any)['submitRAVsInBatches'](
        signedRavs,
        {},
        logger,
      )

      // Should create 2 batches: one with 5, one with 2
      expect(batches).toHaveLength(2)
      expect(batches[0]).toHaveLength(5)
      expect(batches[1]).toHaveLength(2)
    })

    test('should process RAVs individually if below threshold', async () => {
      // Create 2 RAVs with low values (below threshold)
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('5', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('3', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('50', 18).toBigInt()),
        })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      const individualRavs: {
        rav: ReceiptAggregateVoucher
        allocation: Allocation
        sender: Address
      }[] = []
      const redeemRavSpy = jest
        .spyOn(tapCollector, 'redeemRav')
        .mockImplementation(async () => {
          // Mock implementation - don't need to store rav
        })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tapCollector as any)['submitRAVs'](signedRavs, {}, logger)

      // Should process individually, not in batches
      expect(redeemRavSpy).toHaveBeenCalledTimes(2)
      expect(individualRavs).toHaveLength(2)
    })
  })

  describe('Escrow balance validation', () => {
    test('should filter out RAVs exceeding escrow balance', async () => {
      // Create RAVs with different values
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('40', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('30', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_3,
          SENDER_ADDRESS_2,
          utils.parseUnits('20', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances: SENDER_1 has 50 GRT, SENDER_2 has 15 GRT
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest.fn().mockImplementation((sender: Address) => {
            if (sender === SENDER_ADDRESS_1) {
              return utils.parseUnits('50', 18).toBigInt()
            }
            return utils.parseUnits('15', 18).toBigInt()
          }),
        })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batches = await (tapCollector as any)['submitRAVsInBatches'](
        signedRavs,
        {},
        logger,
      )

      // Should only include RAVs that fit within balance
      // SENDER_1: only the 30 GRT RAV fits within 50 GRT balance
      // SENDER_2: 20 GRT RAV exceeds 15 GRT balance
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(1)
      expect(batches[0][0].rav.rav.valueAggregate).toBe(
        utils.parseUnits('30', 18).toString(),
      )
    })
  })

  describe('Batch redemption execution', () => {
    test('should execute batch redemption via Multicall3', async () => {
      // Create RAVs for batch
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_3,
          SENDER_ADDRESS_1,
          utils.parseUnits('10', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      // Mock Multicall3
      const mockMulticall3 = {
        callStatic: {
          aggregate3: jest.fn().mockResolvedValue([
            { success: true, returnData: '0x' },
            { success: true, returnData: '0x' },
            { success: true, returnData: '0x' },
          ]),
        },
        aggregate3: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({ status: 1 }),
        }),
      }
      tapCollector['multicall3'] = mockMulticall3 as unknown as ethers.Contract

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      await tapCollector['redeemRAVBatch'](signedRavs, {}, logger)

      // Verify Multicall3 was called
      expect(mockMulticall3.callStatic.aggregate3).toHaveBeenCalled()
      expect(mockMulticall3.aggregate3).toHaveBeenCalled()

      // Verify the calls array
      const calls = mockMulticall3.aggregate3.mock.calls[0][0]
      expect(calls).toHaveLength(3)
      expect(calls[0].allowFailure).toBe(false)
    })

    test('should handle partial batch failures', async () => {
      // Create RAVs for batch
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_3,
          SENDER_ADDRESS_1,
          utils.parseUnits('10', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      // Mock Multicall3 with one failure
      const mockMulticall3 = {
        callStatic: {
          aggregate3: jest.fn().mockResolvedValue([
            { success: true, returnData: '0x' },
            { success: false, returnData: '0x' }, // Second RAV fails
            { success: true, returnData: '0x' },
          ]),
        },
      }
      tapCollector['multicall3'] = mockMulticall3 as unknown as ethers.Contract

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // Should throw error due to failure
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tapCollector as any)['redeemRAVBatch'](signedRavs, {}, logger),
      ).rejects.toThrow('Batch RAV redemption simulation failed')
    })
  })

  describe('Fallback behavior', () => {
    test('should fall back to individual redemption on batch failure', async () => {
      // Create RAVs for batch
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      // Mock Multicall3 to fail
      const mockMulticall3 = {
        callStatic: {
          aggregate3: jest.fn().mockRejectedValue(new Error('Multicall failed')),
        },
      }
      tapCollector['multicall3'] = mockMulticall3 as unknown as ethers.Contract

      // Mock individual redeem
      const individualRedeems: unknown[] = []
      jest.spyOn(tapCollector, 'redeemRav').mockImplementation(async (rav) => {
        individualRedeems.push(rav)
      })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tapCollector as any)['submitRAVs'](signedRavs, {}, logger)

      // Should fall back to individual redemptions
      expect(individualRedeems).toHaveLength(2)
    })

    test('should use individual redemption when batching disabled', async () => {
      // Disable batching
      tapCollector['ravRedemptionBatchSize'] = 1

      // Create RAVs
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      // Mock individual redeem
      const individualRedeems: unknown[] = []
      jest.spyOn(tapCollector, 'redeemRav').mockImplementation(async (rav) => {
        individualRedeems.push(rav)
      })

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tapCollector as any)['submitRAVs'](signedRavs, {}, logger)

      // Should use individual redemptions
      expect(individualRedeems).toHaveLength(2)
    })
  })

  describe('Metrics tracking', () => {
    test('should track batch redemption metrics', async () => {
      // Create RAVs for batch
      const ravs = [
        createRAV(
          ALLOCATION_ID_1,
          SENDER_ADDRESS_1,
          utils.parseUnits('20', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_2,
          SENDER_ADDRESS_1,
          utils.parseUnits('15', 18).toBigInt(),
        ),
        createRAV(
          ALLOCATION_ID_3,
          SENDER_ADDRESS_1,
          utils.parseUnits('10', 18).toBigInt(),
        ),
      ]

      await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravs)

      // Mock escrow balances
      jest
        .spyOn(
          tapCollector as unknown as {
            getEscrowAccounts: () => Promise<{
              getBalanceForSender: (sender: Address) => bigint
            }>
          },
          'getEscrowAccounts',
        )
        .mockResolvedValue({
          getBalanceForSender: jest
            .fn()
            .mockReturnValue(utils.parseUnits('100', 18).toBigInt()),
        })

      // Mock Multicall3
      const mockMulticall3 = {
        callStatic: {
          aggregate3: jest.fn().mockResolvedValue([
            { success: true, returnData: '0x' },
            { success: true, returnData: '0x' },
            { success: true, returnData: '0x' },
          ]),
        },
        aggregate3: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({ status: 1 }),
        }),
      }
      tapCollector['multicall3'] = mockMulticall3 as unknown as ethers.Contract

      // Spy on metrics
      const batchSizeSpy = jest.spyOn(tapCollector['metrics'].ravBatchRedeemSize, 'set')
      const batchSuccessSpy = jest.spyOn(
        tapCollector['metrics'].ravBatchRedeemSuccess,
        'inc',
      )

      const pendingRavs = await tapCollector['pendingRAVs']()
      const signedRavs = pendingRavs.map((rav) => ({
        rav: rav.getSignedRAV(),
        allocation: {} as Allocation,
        sender: rav.senderAddress,
      }))

      await tapCollector['redeemRAVBatch'](signedRavs, {}, logger)

      // Verify metrics were tracked
      expect(batchSizeSpy).toHaveBeenCalledWith(3)
      expect(batchSuccessSpy).toHaveBeenCalled()
    })
  })
})
