// Imported from source rather than from '@graphprotocol/indexer-common', whose main
// entry point is the compiled ./dist bundle. Going through the package would test
// whatever was last built instead of the code in this working tree.
import { defineQueryFeeModels, QueryFeeModels } from '../../query-fees/models'
import { TapCollector } from '../tap-collector'
import { GraphTallyCollector } from '../graph-tally-collector'
import {
  connectDatabase,
  createLogger,
  Logger,
  toAddress,
} from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

let logger: Logger
let sequelize: Sequelize
let queryFeeModels: QueryFeeModels

const SIGNATURE = Uint8Array.from(Buffer.alloc(65, 1))
const PAYER = toAddress('deadbeefcafebabedeadbeefcafebabedeadbeef')
const DATA_SERVICE = toAddress('0000000000000000000000000000000000000001')
const SERVICE_PROVIDER = toAddress('0000000000000000000000000000000000000002')

// Values are deliberately inserted out of order so a passing assertion cannot be
// explained by Postgres happening to return rows in insertion order.
const V1_RAVS = [
  { allocationId: toAddress('1111111111111111111111111111111111111111'), value: 5n },
  { allocationId: toAddress('2222222222222222222222222222222222222222'), value: 100n },
  { allocationId: toAddress('3333333333333333333333333333333333333333'), value: 1n },
  { allocationId: toAddress('4444444444444444444444444444444444444444'), value: 50n },
]

const V2_RAVS = [
  { collectionId: `0x${'a'.repeat(64)}`, value: 7n },
  { collectionId: `0x${'b'.repeat(64)}`, value: 900n },
  { collectionId: `0x${'c'.repeat(64)}`, value: 3n },
  { collectionId: `0x${'d'.repeat(64)}`, value: 42n },
]

const setup = async () => {
  logger = createLogger({
    name: 'pending-ravs-order',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
}

const teardown = async () => {
  await sequelize.drop({})
  await sequelize.close()
}

beforeAll(setup, 30000)
afterAll(teardown, 30000)
beforeEach(async () => {
  sequelize = await sequelize.sync({ force: true })
})

describe('pendingRAVs ordering', () => {
  test('TAPv1 returns pending RAVs ordered by value, highest first', async () => {
    // Arrange
    for (const { allocationId, value } of V1_RAVS) {
      await queryFeeModels.receiptAggregateVouchers.create({
        allocationId,
        senderAddress: PAYER,
        signature: SIGNATURE,
        timestampNs: 1n,
        valueAggregate: value,
        last: true,
        final: false,
        redeemedAt: null,
      })
    }
    const collector: TapCollector = Object.assign(Object.create(TapCollector.prototype), {
      logger,
      models: queryFeeModels,
    })

    // Act
    const ravs = await collector['pendingRAVs']()

    // Assert
    expect(ravs.map((rav) => rav.valueAggregate)).toEqual([100n, 50n, 5n, 1n])
  })

  test('TAPv2 returns pending RAVs ordered by value, highest first', async () => {
    // Arrange
    for (const { collectionId, value } of V2_RAVS) {
      await queryFeeModels.receiptAggregateVouchersV2.create({
        collectionId,
        payer: PAYER,
        dataService: DATA_SERVICE,
        serviceProvider: SERVICE_PROVIDER,
        signature: SIGNATURE,
        metadata: '0x',
        timestampNs: 1n,
        valueAggregate: value,
        last: true,
        final: false,
        redeemedAt: null,
      })
    }
    const collector: GraphTallyCollector = Object.assign(
      Object.create(GraphTallyCollector.prototype),
      { logger, models: queryFeeModels },
    )

    // Act
    const ravs = await collector['pendingRAVs']()

    // Assert
    expect(ravs.map((rav) => rav.valueAggregate)).toEqual([900n, 42n, 7n, 3n])
  })

  test('TAPv1 ordering surfaces high value RAVs from beyond the 100 row limit', async () => {
    // Arrange: 100 dust RAVs that would fill the batch on their own, plus one
    // valuable RAV inserted last so insertion order alone would exclude it.
    for (let i = 0; i < 100; i++) {
      await queryFeeModels.receiptAggregateVouchers.create({
        allocationId: toAddress(i.toString(16).padStart(40, '0')),
        senderAddress: PAYER,
        signature: SIGNATURE,
        timestampNs: 1n,
        valueAggregate: 1n,
        last: true,
        final: false,
        redeemedAt: null,
      })
    }
    await queryFeeModels.receiptAggregateVouchers.create({
      allocationId: toAddress('ffffffffffffffffffffffffffffffffffffffff'),
      senderAddress: PAYER,
      signature: SIGNATURE,
      timestampNs: 1n,
      valueAggregate: 10n ** 21n, // 1,000 GRT
      last: true,
      final: false,
      redeemedAt: null,
    })
    const collector: TapCollector = Object.assign(Object.create(TapCollector.prototype), {
      logger,
      models: queryFeeModels,
    })

    // Act
    const ravs = await collector['pendingRAVs']()

    // Assert
    expect(ravs).toHaveLength(100)
    expect(ravs[0].valueAggregate).toEqual(10n ** 21n)
  })

  test('TAPv2 ordering surfaces high value RAVs from beyond the 100 row limit', async () => {
    // Arrange
    for (let i = 0; i < 100; i++) {
      await queryFeeModels.receiptAggregateVouchersV2.create({
        collectionId: `0x${i.toString(16).padStart(64, '0')}`,
        payer: PAYER,
        dataService: DATA_SERVICE,
        serviceProvider: SERVICE_PROVIDER,
        signature: SIGNATURE,
        metadata: '0x',
        timestampNs: 1n,
        valueAggregate: 1n,
        last: true,
        final: false,
        redeemedAt: null,
      })
    }
    await queryFeeModels.receiptAggregateVouchersV2.create({
      collectionId: `0x${'f'.repeat(64)}`,
      payer: PAYER,
      dataService: DATA_SERVICE,
      serviceProvider: SERVICE_PROVIDER,
      signature: SIGNATURE,
      metadata: '0x',
      timestampNs: 1n,
      valueAggregate: 10n ** 21n, // 1,000 GRT
      last: true,
      final: false,
      redeemedAt: null,
    })
    const collector: GraphTallyCollector = Object.assign(
      Object.create(GraphTallyCollector.prototype),
      { logger, models: queryFeeModels },
    )

    // Act
    const ravs = await collector['pendingRAVs']()

    // Assert
    expect(ravs).toHaveLength(100)
    expect(ravs[0].valueAggregate).toEqual(10n ** 21n)
  })

  test('pendingRAVs excludes final and non-last RAVs regardless of value', async () => {
    // Arrange
    await queryFeeModels.receiptAggregateVouchers.create({
      allocationId: V1_RAVS[0].allocationId,
      senderAddress: PAYER,
      signature: SIGNATURE,
      timestampNs: 1n,
      valueAggregate: 10n ** 21n,
      last: true,
      final: true, // already finalized
      redeemedAt: null,
    })
    await queryFeeModels.receiptAggregateVouchers.create({
      allocationId: V1_RAVS[1].allocationId,
      senderAddress: PAYER,
      signature: SIGNATURE,
      timestampNs: 1n,
      valueAggregate: 10n ** 21n,
      last: false, // superseded by a newer RAV
      final: false,
      redeemedAt: null,
    })
    await queryFeeModels.receiptAggregateVouchers.create({
      allocationId: V1_RAVS[2].allocationId,
      senderAddress: PAYER,
      signature: SIGNATURE,
      timestampNs: 1n,
      valueAggregate: 5n,
      last: true,
      final: false,
      redeemedAt: null,
    })
    const collector: TapCollector = Object.assign(Object.create(TapCollector.prototype), {
      logger,
      models: queryFeeModels,
    })

    // Act
    const ravs = await collector['pendingRAVs']()

    // Assert
    expect(ravs).toHaveLength(1)
    expect(ravs[0].valueAggregate).toEqual(5n)
  })
})
