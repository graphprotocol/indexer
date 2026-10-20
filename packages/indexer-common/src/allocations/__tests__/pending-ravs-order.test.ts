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
import { Op, Sequelize } from 'sequelize'
import { buildSchema, DocumentNode, execute, validate } from 'graphql'
import { SubgraphClient } from '../../subgraph-client'
import { CombinedError } from '@urql/core'

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

  test('TAPv1 ordering surfaces high value RAVs from beyond a full batch', async () => {
    // Arrange: 1,000 dust RAVs that would fill the batch on their own, plus one
    // valuable RAV inserted last so insertion order alone would exclude it.
    await queryFeeModels.receiptAggregateVouchers.bulkCreate(
      Array.from({ length: 1000 }, (_, i) => ({
        allocationId: toAddress(i.toString(16).padStart(40, '0')),
        senderAddress: PAYER,
        signature: SIGNATURE,
        timestampNs: 1n,
        valueAggregate: 1n,
        last: true,
        final: false,
        redeemedAt: null,
      })),
    )
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
    expect(ravs).toHaveLength(1000)
    expect(ravs[0].valueAggregate).toEqual(10n ** 21n)
  })

  test('TAPv2 ordering surfaces high value RAVs from beyond a full batch', async () => {
    // Arrange
    await queryFeeModels.receiptAggregateVouchersV2.bulkCreate(
      Array.from({ length: 1000 }, (_, i) => ({
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
      })),
    )
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
    expect(ravs).toHaveLength(1000)
    expect(ravs[0].valueAggregate).toEqual(10n ** 21n)
  })

  test('findTransactionsForRavs chunks the allocation id filter and pins one block', async () => {
    // Arrange: 250 pending RAVs with distinct allocations, and a fake subgraph client
    // that records each request it receives.
    const ravs = Array.from({ length: 250 }, (_, i) => ({
      collectionId: `0x${i.toString(16).padStart(64, '0')}`,
      payer: PAYER,
      redeemedAt: null,
    })) as unknown as Parameters<GraphTallyCollector['findTransactionsForRavs']>[0]
    const query = jest.fn().mockResolvedValue({
      data: {
        paymentsEscrowTransactions: [],
        _meta: { block: { hash: 'pinned-block', timestamp: 1 } },
      },
    })
    const collector: GraphTallyCollector = Object.assign(
      Object.create(GraphTallyCollector.prototype),
      { logger, networkSubgraph: { query } },
    )

    // Act
    const response = await collector.findTransactionsForRavs(ravs)

    // Assert: 250 ids split into chunks of at most 100, so 3 requests
    expect(query).toHaveBeenCalledTimes(3)
    const variables = query.mock.calls.map((call) => call[1])
    for (const vars of variables) {
      expect(vars.unfinalizedRavsAllocationIds.length).toBeLessThanOrEqual(100)
    }
    expect(variables.flatMap((vars) => vars.unfinalizedRavsAllocationIds)).toHaveLength(
      250,
    )
    // The first request floats to the chain head; all later ones are pinned to it
    expect(variables[0].block).toBeUndefined()
    expect(variables[1].block).toEqual({ hash: 'pinned-block' })
    expect(variables[2].block).toEqual({ hash: 'pinned-block' })
    expect(response._meta.block.hash).toEqual('pinned-block')
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

describe.each(['v1', 'v2'] as const)('%s bounded reconciliation progress', (version) => {
  const makeFixture = async (count: number) => {
    const address = (n: number) => toAddress(n.toString(16).padStart(40, '0'))
    const shared = {
      signature: SIGNATURE,
      timestampNs: 1n,
      valueAggregate: 7n,
      last: true,
      final: false,
      redeemedAt: null,
    }
    if (version === 'v1') {
      await queryFeeModels.receiptAggregateVouchers.bulkCreate(
        Array.from({ length: count }, (_, i) => ({
          ...shared,
          allocationId: address(Math.floor(i / 4)),
          senderAddress: address(i % 4),
        })),
      )
    } else {
      await queryFeeModels.receiptAggregateVouchersV2.bulkCreate(
        Array.from({ length: count }, (_, i) => ({
          ...shared,
          collectionId: `0x${Math.floor(i / 64)
            .toString(16)
            .padStart(64, '0')}`,
          payer: address(Math.floor(i / 16) % 4),
          serviceProvider: address(Math.floor(i / 4) % 4),
          dataService: address(i % 4),
          metadata: '0x',
        })),
      )
    }
    const collector =
      version === 'v1'
        ? Object.assign(Object.create(TapCollector.prototype) as TapCollector, {
            logger,
            models: queryFeeModels,
            finalityTime: 1000,
          })
        : Object.assign(
            Object.create(GraphTallyCollector.prototype) as GraphTallyCollector,
            { logger, models: queryFeeModels, finalityTime: 1000 },
          )
    const model =
      version === 'v1'
        ? queryFeeModels.receiptAggregateVouchers
        : queryFeeModels.receiptAggregateVouchersV2
    const key = (rav) =>
      version === 'v1'
        ? `${rav.allocationId}-${rav.senderAddress}`.toLowerCase()
        : `${rav.collectionId}-${rav.payer}-${rav.serviceProvider}-${rav.dataService}`.toLowerCase()
    return { collector, model, key }
  }

  test('visits all composite-key ties without waiting for earlier RAVs to settle, then wraps', async () => {
    const { collector, key } = await makeFixture(2003)
    const first = await collector['pendingRAVs']()
    const second = await collector['pendingRAVs']()
    const third = await collector['pendingRAVs']()
    expect(first).toHaveLength(1000)
    expect(second).toHaveLength(1000)
    expect(third).toHaveLength(3)
    const keys = [...first, ...second, ...third].map(key)
    expect(new Set(keys).size).toBe(2003)
    expect(keys).toEqual([...keys].sort())
    expect((await collector['pendingRAVs']()).map(key)).toEqual(first.map(key))
  })

  test.each(['stable', 'missing', 'inconsistent', 'partial error'])(
    'transaction snapshot stays pinned or rejects %s pages',
    async (mode) => {
      const { collector } = await makeFixture(0)
      const rows = Array.from({ length: 250 }, (_, i) => ({
        allocationId: toAddress(i.toString(16).padStart(40, '0')),
        collectionId: `0x${i.toString(16).padStart(64, '0')}`,
        senderAddress: PAYER,
        payer: PAYER,
        redeemedAt: null,
      }))
      const schema = buildSchema(`
      input Block_height { hash: String! }
      input Address_filter { id_in: [String!]! }
      input Tx_filter { id_gt: String!, type: String!, allocationID_in: [String!]!, sender_: Address_filter! }
      input Payment_filter { id_gt: String!, type: String!, allocationId_in: [String!]!, payer_: Address_filter! }
      enum OrderDirection { asc desc }
      enum Tx_orderBy { id }
      type Address { id: String! }
      type Tx { id: String!, allocationID: String!, timestamp: Int!, sender: Address! }
      type Payment { id: String!, allocationId: String!, timestamp: Int!, payer: Address! }
      type Block { hash: String!, timestamp: Int! }
      type Meta { block: Block! }
      type Query {
        transactions(first: Int!, block: Block_height, orderBy: Tx_orderBy, orderDirection: OrderDirection, where: Tx_filter!): [Tx!]!
        paymentsEscrowTransactions(first: Int!, block: Block_height, orderBy: Tx_orderBy, orderDirection: OrderDirection, where: Payment_filter!): [Payment!]!
        _meta(block: Block_height): Meta!
      }
    `)
      const firstHash = 'first-block'
      const query = jest.fn(
        async (document: DocumentNode, variables: Record<string, unknown>) => {
          expect(validate(schema, document)).toEqual([])
          const txs = ({ first, where }) =>
            Array.from({ length: 201 }, (_, i) => ({
              id: `tx-${i.toString().padStart(4, '0')}`,
              allocationID: '0x0000000000000000000000000000000000000000',
              allocationId: '0x0000000000000000000000000000000000000000',
              sender: { id: PAYER },
              payer: { id: PAYER },
              timestamp: 900,
            }))
              .filter(
                (tx) =>
                  tx.id > where.id_gt &&
                  (where.allocationID_in ?? where.allocationId_in).includes(
                    tx.allocationId,
                  ),
              )
              .slice(0, first)
          const result = await execute({
            schema,
            document,
            variableValues: variables,
            rootValue: {
              transactions: txs,
              paymentsEscrowTransactions: txs,
              _meta: ({ block }) => ({
                block: {
                  hash:
                    block?.hash ??
                    (query.mock.calls.length === 1 ? firstHash : 'new-head'),
                  timestamp:
                    block?.hash === firstHash || query.mock.calls.length === 1
                      ? 1000
                      : 2000,
                },
              }),
            },
          })
          expect(result.errors).toBeUndefined()
          if (query.mock.calls.length === 2) {
            if (mode === 'missing') delete result.data!._meta
            if (mode === 'inconsistent')
              result.data!._meta = { block: { hash: 'wrong-block', timestamp: 2000 } }
          }
          return {
            data: result.data,
            error:
              mode === 'partial error' && query.mock.calls.length === 2
                ? new CombinedError({ graphQLErrors: ['incomplete transaction page'] })
                : undefined,
          }
        },
      )
      Object.assign(collector, {
        tapSubgraph: { query } as unknown as SubgraphClient,
        networkSubgraph: { query } as unknown as SubgraphClient,
      })
      const pending =
        version === 'v1'
          ? (collector as TapCollector).findTransactionsForRavs(
              rows as unknown as Parameters<TapCollector['findTransactionsForRavs']>[0],
            )
          : (collector as GraphTallyCollector).findTransactionsForRavs(
              rows as unknown as Parameters<
                GraphTallyCollector['findTransactionsForRavs']
              >[0],
            )
      if (mode !== 'stable') {
        await expect(pending).rejects.toThrow()
        return
      }
      const response = await pending
      expect(query).toHaveBeenCalledTimes(4)
      for (const [, variables] of query.mock.calls.slice(1)) {
        expect(variables.block).toEqual({ hash: firstHash })
      }
      expect(response._meta.block).toEqual({ hash: firstHash, timestamp: 1000 })
    },
  )

  test('wraps an exact full batch and an empty tail after the boundary row is deleted', async () => {
    const { collector, key } = await makeFixture(1000)
    const first = await collector['pendingRAVs']()
    await first[999].destroy()
    expect((await collector['pendingRAVs']()).map(key)).toEqual(
      first.slice(0, 999).map(key),
    )
  })

  test('does not advance past a failed database read', async () => {
    const { collector, model, key } = await makeFixture(1001)
    const first = await collector['pendingRAVs']()
    const find = jest
      .spyOn(model, 'findAll')
      .mockRejectedValueOnce(new Error('database unavailable'))
    await expect(collector['pendingRAVs']()).rejects.toThrow('database unavailable')
    find.mockRestore()
    const next = await collector['pendingRAVs']()
    expect(next).toHaveLength(1)
    expect(first.map(key)).not.toContain(key(next[0]))
  })

  test('revisits rows whose value moves before the cursor on the next sweep', async () => {
    const { collector, key } = await makeFixture(1002)
    await collector['pendingRAVs']()
    const tail = await collector['pendingRAVs']()
    await tail[1].update({ valueAggregate: 100n })
    const next = await collector['pendingRAVs']()
    expect(key(next[0])).toBe(key(tail[1]))
    expect(next[0].valueAggregate).toBe(100n)
  })

  test('continues across value boundaries and retains unredeemed rows outside the reconciliation batch', async () => {
    const { collector, key } = await makeFixture(1002)
    const first = await collector['pendingRAVs']()
    await first[0].update({ valueAggregate: 20n })
    const tail = await collector['pendingRAVs']()
    await tail[1].update({ valueAggregate: 1n })
    // Start a fresh scan, then cross from 7 to 1 without duplicates or omissions.
    const next = await collector['pendingRAVs']()
    const last = await collector['pendingRAVs']()
    expect(next[0].valueAggregate).toBe(20n)
    expect(last.map((rav) => rav.valueAggregate)).toEqual([7n, 1n])
    expect(new Set([...next, ...last].map(key)).size).toBe(1002)

    // Reconciliation bounds do not become redemption eligibility bounds.
    Object.assign(collector, {
      findTransactionsForRavs: jest.fn().mockResolvedValue({
        transactions: [],
        paymentsEscrowTransactions: [],
        _meta: { block: { timestamp: 200, hash: 'block' } },
      }),
    })
    const eligible =
      version === 'v1'
        ? await (collector as TapCollector)['filterAndUpdateRavs'](
            last as Parameters<TapCollector['markRavsInTransactionsAsRedeemed']>[1],
          )
        : await (collector as GraphTallyCollector)['filterAndUpdateRavs'](
            last as Parameters<
              GraphTallyCollector['markRavsInTransactionsAsRedeemed']
            >[1],
          )
    expect(eligible).toHaveLength(1002)
  })

  test('propagates observed-redemption write failures without finalizing or reloading eligible rows', async () => {
    const { collector, model } = await makeFixture(1)
    const rows = await collector['pendingRAVs']()
    const failure = new Error('redemption write failed')
    const finalize = jest.fn()
    Object.assign(collector, {
      findTransactionsForRavs: jest.fn().mockResolvedValue({
        _meta: { block: { timestamp: 200, hash: 'block' } },
      }),
      markRavsInTransactionsAsRedeemed: jest.fn().mockRejectedValue(failure),
      markRavsAsFinal: finalize,
    })
    const reload = jest.spyOn(model, 'findAll')
    try {
      const pending =
        version === 'v1'
          ? (collector as TapCollector)['filterAndUpdateRavs'](
              rows as Parameters<TapCollector['markRavsInTransactionsAsRedeemed']>[1],
            )
          : (collector as GraphTallyCollector)['filterAndUpdateRavs'](
              rows as Parameters<
                GraphTallyCollector['markRavsInTransactionsAsRedeemed']
              >[1],
            )
      await expect(pending).rejects.toBe(failure)
      expect(finalize).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    } finally {
      reload.mockRestore()
    }
  })

  test('awaits observed redemption writes before finalization and the eligibility reload', async () => {
    const { collector } = await makeFixture(1)
    const rows = await collector['pendingRAVs']()
    const row = rows[0]
    const response =
      version === 'v1'
        ? {
            transactions: [
              {
                id: 'tx',
                allocationID: row['allocationId'],
                sender: { id: row['senderAddress'] },
                timestamp: 100,
              },
            ],
            _meta: { block: { timestamp: 200, hash: 'block' } },
          }
        : {
            paymentsEscrowTransactions: [
              {
                id: 'tx',
                allocationId: `0x${row['collectionId'].slice(-40)}`,
                payer: { id: row['payer'] },
                timestamp: 100,
              },
            ],
            _meta: { block: { timestamp: 200, hash: 'block' } },
          }
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const write = collector['markRavAsRedeemed'].bind(collector)
    const finalize = jest.fn(collector['markRavsAsFinal'].bind(collector))
    Object.assign(collector, {
      findTransactionsForRavs: jest.fn().mockResolvedValue(response),
      markRavsAsFinal: finalize,
      markRavAsRedeemed: async (...args: Parameters<typeof write>) => {
        started()
        await gate
        await write(...args)
      },
    })
    // Call through the real reconciliation and real PostgreSQL update. The gate
    // controls the write, not a timer or a guessed scheduling delay.
    const pending =
      version === 'v1'
        ? (collector as TapCollector)['filterAndUpdateRavs'](
            rows as Parameters<TapCollector['markRavsInTransactionsAsRedeemed']>[1],
          )
        : (collector as GraphTallyCollector)['filterAndUpdateRavs'](
            rows as Parameters<
              GraphTallyCollector['markRavsInTransactionsAsRedeemed']
            >[1],
          )
    try {
      await entered
      expect(finalize).not.toHaveBeenCalled()
    } finally {
      release()
      await pending
    }
    expect(await pending).toHaveLength(0)
    const options = { where: { redeemedAt: { [Op.ne]: null } } }
    expect(
      await (version === 'v1'
        ? queryFeeModels.receiptAggregateVouchers.count(options)
        : queryFeeModels.receiptAggregateVouchersV2.count(options)),
    ).toBe(1)
  })
})
