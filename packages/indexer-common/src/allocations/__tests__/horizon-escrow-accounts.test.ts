import { createLogger } from '@graphprotocol/common-ts'
import { buildSchema, DocumentNode, execute, validate } from 'graphql'
import { CombinedError } from '@urql/core'
import { SubgraphClient } from '../../subgraph-client'
import { getEscrowAccounts } from '../horizon-escrow-accounts'

const logger = createLogger({ name: 'horizon-escrow-pagination', level: 'fatal' })
const indexer = `0x${'1'.repeat(40)}`
const collector = `0x${'2'.repeat(40)}`
const blockHash = `0x${'a'.repeat(64)}`
const payer = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const collection = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

// Model Graph Node's default first: 100, keyset filters and block arguments. Execute
// the real query so omitting first/orderBy/block cannot accidentally pass the mock.
const schema = buildSchema(`
  input Block_height { hash: String! }
  input Receiver_filter { id: ID! }
  input Account_filter { receiver_: Receiver_filter!, collector: String!, id_gt: String }
  input Collected_filter { receiver_: Receiver_filter!, id_gt: String }
  enum OrderDirection { asc desc }
  enum Entity_orderBy { id }
  type Payer { id: String! }
  type Account { id: String!, balance: String!, payer: Payer! }
  type Collected { id: String!, tokens: String!, collectionId: String!, payer: Payer! }
  type Block { hash: String! }
  type Meta { block: Block! }
  type Query {
    paymentsEscrowAccounts(first: Int = 100, where: Account_filter!,
      orderBy: Entity_orderBy, orderDirection: OrderDirection, block: Block_height): [Account!]!
    graphTallyTokensCollecteds(first: Int = 100, where: Collected_filter!,
      orderBy: Entity_orderBy, orderDirection: OrderDirection, block: Block_height): [Collected!]!
    _meta(block: Block_height): Meta!
  }
`)

const fixture = (accountCount: number, collectedCount: number) => {
  const accounts = Array.from({ length: accountCount }, (_, i) => ({
    id: `account-${i.toString().padStart(6, '0')}`,
    payer: { id: payer(i) },
    balance: (10n ** 24n + BigInt(i)).toString(),
  }))
  const collected = Array.from({ length: collectedCount }, (_, i) => ({
    id: `collected-${i.toString().padStart(6, '0')}`,
    payer: { id: payer(i % Math.max(accountCount, 1)) },
    collectionId: collection(i),
    tokens: (10n ** 20n + BigInt(i)).toString(),
  }))
  const read = jest.fn(({ first, where, orderBy, orderDirection, block }, rows) => {
    if (block) {
      expect(block.hash).toBe(blockHash)
    }
    const ordered =
      orderBy === 'id' && orderDirection === 'asc' ? rows : [...rows].reverse()
    return ordered.filter((row) => !where.id_gt || row.id > where.id_gt).slice(0, first)
  })
  const query = jest.fn(
    async (document: DocumentNode, variables: Record<string, unknown>) => {
      expect(validate(schema, document)).toEqual([])
      const result = await execute({
        schema,
        document,
        variableValues: variables,
        rootValue: {
          paymentsEscrowAccounts: (args) => read(args, accounts),
          graphTallyTokensCollecteds: (args) => read(args, collected),
          _meta: ({ block }) => {
            if (block) expect(block.hash).toBe(blockHash)
            return {
              block: {
                hash:
                  block?.hash ??
                  (query.mock.calls.length === 1 ? blockHash : `0x${'b'.repeat(64)}`),
              },
            }
          },
        },
      })
      return {
        data: result.data,
        error: result.errors
          ? new CombinedError({ graphQLErrors: [...result.errors] })
          : undefined,
      }
    },
  )
  return {
    accounts,
    collected,
    query,
    read,
    client: { query } as unknown as SubgraphClient,
  }
}

describe('Horizon escrow snapshot pagination', () => {
  test('includes every payer balance and collected amount beyond the default page', async () => {
    const { client, query, accounts, collected } = fixture(201, 1203)
    const escrow = await getEscrowAccounts(logger, client, indexer, collector)
    for (const account of accounts) {
      expect(escrow.getBalanceForPayer(account.payer.id.toUpperCase())).toBe(
        BigInt(account.balance),
      )
    }
    for (const record of collected) {
      expect(
        escrow.getTokensCollectedForReceiver(
          record.payer.id,
          record.collectionId.toUpperCase(),
        ),
      ).toBe(BigInt(record.tokens))
    }
    expect(query.mock.calls.length).toBeGreaterThan(1)
    expect(escrow.getTokensCollectedForReceiver(payer(0), collection(9999))).toBe(0n)
  })

  test.each([
    [0, 0],
    [1000, 1000],
    [1001, 0],
    [0, 1001],
  ])(
    'finishes independent collections with %i accounts and %i collected records',
    async (accountCount, collectedCount) => {
      const { client, accounts, collected } = fixture(accountCount, collectedCount)
      const escrow = await getEscrowAccounts(logger, client, indexer, collector)
      for (const account of accounts)
        expect(escrow.getBalanceForPayer(account.payer.id)).toBe(BigInt(account.balance))
      for (const record of collected)
        expect(
          escrow.getTokensCollectedForReceiver(record.payer.id, record.collectionId),
        ).toBe(BigInt(record.tokens))
    },
  )

  test('pins all entity pages and metadata to the first block despite a newer head', async () => {
    const { client, query, read } = fixture(1001, 1001)
    await getEscrowAccounts(logger, client, indexer, collector)
    expect(query.mock.calls.length).toBeGreaterThan(1)
    // A floating request would read a different head here after the first call.
    for (const [args] of read.mock.calls.slice(2))
      expect(args.block).toEqual({ hash: blockHash })
    for (const [, variables] of query.mock.calls.slice(1))
      expect(variables).toMatchObject({ block: { hash: blockHash } })
  })

  test.each([1, 2])(
    'rejects GraphQL errors with partial data on page %i',
    async (errorPage) => {
      const { client, query } = fixture(1001, 1001)
      const original = query.getMockImplementation()!
      query.mockImplementation(async (...args) => ({
        ...(await original(...args)),
        error:
          query.mock.calls.length === errorPage
            ? new CombinedError({ graphQLErrors: ['incomplete indexed data'] })
            : undefined,
      }))
      await expect(
        getEscrowAccounts(logger, client, indexer, collector),
      ).rejects.toThrow()
    },
  )

  test('rejects a later failed page instead of returning incomplete collected amounts', async () => {
    const { client, query } = fixture(1001, 1001)
    const original = query.getMockImplementation()!
    query.mockImplementation(async (...args) => {
      if (query.mock.calls.length > 1) throw new Error('subgraph unavailable')
      return original(...args)
    })
    await expect(getEscrowAccounts(logger, client, indexer, collector)).rejects.toThrow(
      'subgraph unavailable',
    )
  })

  test.each(['missing', 'changed'])('rejects %s snapshot metadata', async (mode) => {
    const { client, query } = fixture(1001, 1001)
    const original = query.getMockImplementation()!
    query.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (mode === 'missing') delete result.data!._meta
      else if (query.mock.calls.length > 1)
        result.data!._meta = { block: { hash: 'other-block' } }
      return result
    })
    await expect(getEscrowAccounts(logger, client, indexer, collector)).rejects.toThrow()
  })

  test.each(['paymentsEscrowAccounts', 'graphTallyTokensCollecteds'])(
    'rejects non-advancing %s pages',
    async (field) => {
      const { client, query } = fixture(1001, 1001)
      const original = query.getMockImplementation()!
      let first
      query.mockImplementation(async (...args) => {
        const result = await original(...args)
        first ??= result.data![field]
        result.data![field] = first
        return result
      })
      await expect(
        getEscrowAccounts(logger, client, indexer, collector),
      ).rejects.toThrow()
    },
  )

  test('uses the complete collected amount for remaining value and balance updates', async () => {
    const { client, collected } = fixture(1, 1203)
    const escrow = await getEscrowAccounts(logger, client, indexer, collector)
    const record = collected[1202]
    const cumulativeRavValue = BigInt(record.tokens) + 3n
    const remaining =
      cumulativeRavValue -
      escrow.getTokensCollectedForReceiver(payer(0), record.collectionId)
    expect(remaining).toBe(3n)
    const oldBalance = escrow.getBalanceForPayer(payer(0))
    escrow.updateBalances(payer(0), record.collectionId, remaining)
    expect(escrow.getBalanceForPayer(payer(0))).toBe(oldBalance - 3n)
    expect(escrow.getTokensCollectedForReceiver(payer(0), record.collectionId)).toBe(
      cumulativeRavValue,
    )
    expect(() =>
      escrow.updateBalances(payer(0), record.collectionId, oldBalance),
    ).toThrow('Negative balances')
  })
})
