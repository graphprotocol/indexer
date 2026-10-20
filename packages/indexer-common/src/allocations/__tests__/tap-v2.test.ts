import {
  connectDatabase,
  createLogger,
  Logger,
  toAddress,
} from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'
import { defineQueryFeeModels, QueryFeeModels } from '../../query-fees/models'
import { GraphTallyCollector, SubgraphResponse } from '../graph-tally-collector'
import { PaymentsEscrowAccounts } from '../horizon-escrow-accounts'

jest.mock('../horizon-escrow-accounts', () => {
  const actual = jest.requireActual('../horizon-escrow-accounts')
  return { ...actual, getEscrowAccounts: jest.fn() }
})
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getEscrowAccounts } = require('../horizon-escrow-accounts')

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

let logger: Logger
let sequelize: Sequelize
let queryFeeModels: QueryFeeModels
let graphTallyCollector: GraphTallyCollector

const timeout = 30000
const FINALITY_TIME = 3600

const INDEXER_ADDRESS = toAddress('0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed')
const COLLECTOR_ADDRESS = toAddress('0x5aeef48fe943f91c39a7609049f8968f5b84414e')

const ALLOCATION_ID_1 = toAddress('0xedde47df40c29949a75a6693c77834c00b8ad626')
const ALLOCATION_ID_2 = toAddress('0xdead47df40c29949a75a6693c77834c00b8ad624')

const PAYER_1 = toAddress('0xffcf8fdee72ac11b5c542428b35eef5769c409f0')
const PAYER_2 = toAddress('0x9fbda871d559710256a2502a2517b794b482db40')

const DATA_SERVICE = toAddress('0x0355b7b8cb128fa5692729ab3aaa199c1753f726')
const SERVICE_PROVIDER = INDEXER_ADDRESS

const SIGNATURE = Buffer.from(
  'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
  'hex',
)

const GRT = 10n ** 18n
// A RAV that grew to 15 GRT after 5 GRT of it had already been collected on chain.
const RAV_VALUE = 15n * GRT
const PARTIALLY_COLLECTED = 5n * GRT

// A collection id is the 20 byte allocation id right-aligned in 32 bytes.
const collectionIdFor = (allocationId: string): string =>
  `0x${'0'.repeat(24)}${allocationId.toLowerCase().replace(/^0x/, '')}`

const COLLECTION_ID_1 = collectionIdFor(ALLOCATION_ID_1)
const COLLECTION_ID_2 = collectionIdFor(ALLOCATION_ID_2)

const createRav = (
  collectionId: string,
  payer: string,
  redeemedAt: Date | null,
  valueAggregate: bigint = RAV_VALUE,
) => ({
  collectionId,
  payer,
  dataService: DATA_SERVICE,
  serviceProvider: SERVICE_PROVIDER,
  timestampNs: 1709067401177959664n,
  valueAggregate,
  metadata: '',
  signature: SIGNATURE,
  last: true,
  final: false,
  redeemedAt,
})

// Builds the escrow accounts exactly as the subgraph would: 0x prefixed, cumulative
// tokensCollected per payer and collection.
const escrowAccountsWith = (
  collected: { payer: string; collectionId: string; tokens: bigint }[],
): PaymentsEscrowAccounts =>
  PaymentsEscrowAccounts.fromResponse(logger, {
    paymentsEscrowAccounts: [],
    graphTallyTokensCollecteds: collected.map((entry) => ({
      tokens: entry.tokens.toString(),
      collectionId: entry.collectionId,
      payer: { id: entry.payer },
    })),
  })

const mockEscrow = (
  collected: { payer: string; collectionId: string; tokens: bigint }[],
) => {
  getEscrowAccounts.mockResolvedValue(escrowAccountsWith(collected))
}

const mockTransactions = (
  transactions: { allocationId: string; payer: string; timestamp: number }[],
  blockTimestamp: number,
) => {
  jest
    .spyOn(graphTallyCollector, 'findTransactionsForRavs')
    .mockImplementation(async (): Promise<SubgraphResponse> => {
      return {
        paymentsEscrowTransactions: transactions.map((tx, index) => ({
          id: `tx-${index}`,
          allocationId: tx.allocationId.toLowerCase(),
          timestamp: tx.timestamp,
          payer: { id: tx.payer.toLowerCase() },
        })),
        _meta: { block: { timestamp: blockTimestamp, hash: 'block-hash' } },
      }
    })
}

const setup = async () => {
  logger = createLogger({
    name: 'GraphTallyCollector tests',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  // Instantiating through Network.create would require a live chain connection for the
  // contracts, so we build the collector directly and keep the database models real.
  graphTallyCollector = Object.create(GraphTallyCollector.prototype)
  Object.assign(graphTallyCollector, {
    logger,
    models: queryFeeModels,
    contracts: { GraphTallyCollector: { target: COLLECTOR_ADDRESS } },
    networkSubgraph: {},
    protocolNetwork: 'eip155:1337',
    indexerAddress: INDEXER_ADDRESS,
    finalityTime: FINALITY_TIME,
  })
}

const teardownEach = async () => {
  jest.restoreAllMocks()
  getEscrowAccounts.mockReset()
  await queryFeeModels.receiptAggregateVouchersV2.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
  await sequelize.close()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filterAndUpdateRavs = async (): Promise<any[]> => {
  const pending = await graphTallyCollector['pendingRAVs']()
  return await graphTallyCollector['filterAndUpdateRavs'](pending)
}

// Sequelize does not run the column setters on `where` clauses, so we match on the
// getters instead of asking the database for a 0x prefixed collection id.
const findRav = async (collectionId: string, payer: string) => {
  const ravs = await queryFeeModels.receiptAggregateVouchersV2.findAll()
  const rav = ravs.find(
    (candidate) =>
      candidate.collectionId.toLowerCase() === collectionId.toLowerCase() &&
      candidate.payer.toLowerCase() === payer.toLowerCase(),
  )
  if (!rav) {
    throw new Error(`RAV not found for ${payer} ${collectionId}`)
  }
  return rav
}

describe('GraphTallyCollector partial collection', () => {
  beforeAll(setup, timeout)
  afterEach(teardownEach, timeout)
  afterAll(teardownAll, timeout)

  test(
    'a partially collected RAV is un-redeemed and offered for collection again',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 26 * 24 * 60 * 60

      // The RAV was collected for 5 GRT mid allocation, then grew to 15 GRT.
      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(collectedAtSecs * 1000)),
      )
      mockEscrow([
        { payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: PARTIALLY_COLLECTED },
      ])
      mockTransactions(
        [{ allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: collectedAtSecs }],
        nowSecs,
      )

      const collectable = await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.final).toBe(false)
      expect(rav.redeemedAt).toBeNull()
      expect(collectable).toEqual([
        expect.objectContaining({ collectionId: COLLECTION_ID_1, payer: PAYER_1 }),
      ])
    },
    timeout,
  )

  test(
    'a fully settled RAV older than the finality time becomes final',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 2 * FINALITY_TIME

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(collectedAtSecs * 1000)),
      )
      mockEscrow([{ payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE }])
      mockTransactions(
        [{ allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: collectedAtSecs }],
        nowSecs,
      )

      const collectable = await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.final).toBe(true)
      expect(rav.redeemedAt).not.toBeNull()
      expect(collectable).toEqual([])
    },
    timeout,
  )

  test(
    'a fully settled RAV within the finality time stays non final',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 100

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(collectedAtSecs * 1000)),
      )
      mockEscrow([{ payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE }])
      mockTransactions(
        [{ allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: collectedAtSecs }],
        nowSecs,
      )

      const collectable = await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.final).toBe(false)
      // Settled with a transaction on chain, so the stamp is kept and it is not resubmitted.
      expect(rav.redeemedAt).not.toBeNull()
      expect(collectable).toEqual([])
    },
    timeout,
  )

  test(
    'a submission the subgraph has not indexed yet keeps its redeemed_at stamp',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      // The subgraph is behind: its block predates the submission we just made.
      const blockTimestamp = nowSecs - 600
      const submittedAtSecs = nowSecs

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(submittedAtSecs * 1000)),
      )
      // On chain the collection happened, but neither the escrow accounts nor the
      // transaction list reflect it yet.
      mockEscrow([
        { payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: PARTIALLY_COLLECTED },
      ])
      mockTransactions([], blockTimestamp)

      await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.redeemedAt).not.toBeNull()
      expect(rav.final).toBe(false)
    },
    timeout,
  )

  test(
    'a settled RAV is recognised despite the database storing collection ids without a 0x prefix',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 2 * FINALITY_TIME

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(collectedAtSecs * 1000)),
      )

      // Guard the premise of this test: the raw column really has no 0x prefix.
      const [rawRows] = await sequelize.query(
        'SELECT collection_id, payer FROM tap_horizon_ravs',
      )
      const raw = rawRows[0] as { collection_id: string; payer: string }
      expect(raw.collection_id).toBe(COLLECTION_ID_1.replace(/^0x/, ''))
      expect(raw.payer).toBe(PAYER_1.toLowerCase().replace(/^0x/, ''))

      // The subgraph, by contrast, keys everything 0x prefixed.
      mockEscrow([{ payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE }])
      mockTransactions(
        [{ allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: collectedAtSecs }],
        nowSecs,
      )

      await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.final).toBe(true)
    },
    timeout,
  )

  test(
    'a RAV that was never collected is left unredeemed and offered for collection',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, null),
      )
      // No entry at all for this payer and collection: tokensCollected reads as 0.
      mockEscrow([])
      mockTransactions([], nowSecs)

      const collectable = await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.redeemedAt).toBeNull()
      expect(rav.final).toBe(false)
      expect(collectable).toEqual([
        expect.objectContaining({ collectionId: COLLECTION_ID_1, payer: PAYER_1 }),
      ])
    },
    timeout,
  )

  test(
    'a settled RAV is stamped with the newest collection transaction, not the oldest',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const oldestSecs = nowSecs - 26 * 24 * 60 * 60
      const newestSecs = nowSecs - 2 * FINALITY_TIME

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, null),
      )
      mockEscrow([{ payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE }])
      mockTransactions(
        [
          { allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: oldestSecs },
          { allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: newestSecs },
        ],
        nowSecs,
      )

      await graphTallyCollector['markRavsInTransactionsAsRedeemed'](
        await graphTallyCollector['findTransactionsForRavs']([]),
        await graphTallyCollector['pendingRAVs'](),
        new Set([`${PAYER_1.toLowerCase()}-${COLLECTION_ID_1}`]),
      )

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.redeemedAt).toEqual(new Date(newestSecs * 1000))
    },
    timeout,
  )

  test(
    'marking a RAV redeemed without a timestamp stamps it with the current time',
    async () => {
      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, null),
      )
      const beforeMs = Date.now() - 1000

      // This is the path taken right after we submit a collection on chain.
      await graphTallyCollector['markRavAsRedeemed'](COLLECTION_ID_1, PAYER_1)

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.redeemedAt).not.toBeNull()
      expect(rav.redeemedAt!.getTime()).toBeGreaterThanOrEqual(beforeMs)
    },
    timeout,
  )

  test(
    'a reorg that removed the collection transaction clears redeemed_at',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 2 * FINALITY_TIME

      await queryFeeModels.receiptAggregateVouchersV2.create(
        createRav(COLLECTION_ID_1, PAYER_1, new Date(collectedAtSecs * 1000)),
      )
      // The escrow says settled, but the transaction has vanished from the subgraph.
      mockEscrow([{ payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE }])
      mockTransactions([], nowSecs)

      const collectable = await filterAndUpdateRavs()

      const rav = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(rav.redeemedAt).toBeNull()
      expect(rav.final).toBe(false)
      expect(collectable).toEqual([
        expect.objectContaining({ collectionId: COLLECTION_ID_1, payer: PAYER_1 }),
      ])
    },
    timeout,
  )

  test(
    'settlement is tracked per payer, so one payer finalizing does not finalize another',
    async () => {
      const nowSecs = Math.floor(Date.now() / 1000)
      const collectedAtSecs = nowSecs - 2 * FINALITY_TIME
      const redeemedAt = new Date(collectedAtSecs * 1000)

      await queryFeeModels.receiptAggregateVouchersV2.bulkCreate([
        createRav(COLLECTION_ID_1, PAYER_1, redeemedAt),
        createRav(COLLECTION_ID_2, PAYER_2, redeemedAt),
      ])
      // Payer 1 settled in full, payer 2 only partially.
      mockEscrow([
        { payer: PAYER_1, collectionId: COLLECTION_ID_1, tokens: RAV_VALUE },
        { payer: PAYER_2, collectionId: COLLECTION_ID_2, tokens: PARTIALLY_COLLECTED },
      ])
      mockTransactions(
        [
          { allocationId: ALLOCATION_ID_1, payer: PAYER_1, timestamp: collectedAtSecs },
          { allocationId: ALLOCATION_ID_2, payer: PAYER_2, timestamp: collectedAtSecs },
        ],
        nowSecs,
      )

      const collectable = await filterAndUpdateRavs()

      const settled = await findRav(COLLECTION_ID_1, PAYER_1)
      expect(settled.final).toBe(true)

      const partial = await findRav(COLLECTION_ID_2, PAYER_2)
      expect(partial.final).toBe(false)
      expect(partial.redeemedAt).toBeNull()

      expect(collectable).toEqual([
        expect.objectContaining({ collectionId: COLLECTION_ID_2, payer: PAYER_2 }),
      ])
    },
    timeout,
  )
})
