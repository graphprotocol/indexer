import { createLogger, Logger } from '@graphprotocol/common-ts'
import { OfferVerifier } from '../offer-verifier'
import { SubgraphClient } from '../../subgraph-client'

const TEST_ID = '0xabcd1234567890abcdef1234567890ab'
const TEST_HASH = '0x' + 'aa'.repeat(32)
const DIFFERENT_HASH = '0x' + 'bb'.repeat(32)

let logger: Logger

beforeAll(() => {
  logger = createLogger({
    name: 'OfferVerifier Test',
    async: false,
    level: 'error',
  })
})

function mockSubgraph(
  result: { data?: unknown; errors?: unknown } | Error,
): SubgraphClient {
  if (result instanceof Error) {
    return {
      query: jest.fn().mockRejectedValue(result),
    } as unknown as SubgraphClient
  }
  return {
    query: jest.fn().mockResolvedValue(result),
  } as unknown as SubgraphClient
}

describe('OfferVerifier', () => {
  test('returns present when offer hash matches', async () => {
    const subgraph = mockSubgraph({
      data: { offer: { offerHash: TEST_HASH } },
    })
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result).toEqual({ status: 'present', offerHash: TEST_HASH })
  })

  test('matches hashes case-insensitively', async () => {
    const subgraph = mockSubgraph({
      data: { offer: { offerHash: TEST_HASH.toUpperCase().replace('0X', '0x') } },
    })
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result.status).toBe('present')
  })

  test('returns not_yet when offer is null', async () => {
    const subgraph = mockSubgraph({ data: { offer: null } })
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result).toEqual({ status: 'not_yet' })
  })

  test('returns hash_mismatch when hashes differ', async () => {
    const subgraph = mockSubgraph({
      data: { offer: { offerHash: DIFFERENT_HASH } },
    })
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result).toEqual({
      status: 'hash_mismatch',
      onChainHash: DIFFERENT_HASH,
    })
  })

  test('returns unavailable on GraphQL errors', async () => {
    const subgraph = mockSubgraph({
      errors: [{ message: 'subgraph not synced' }],
    })
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result.status).toBe('unavailable')
  })

  test('returns unavailable on network error', async () => {
    const subgraph = mockSubgraph(new Error('ECONNREFUSED'))
    const v = new OfferVerifier(subgraph, logger)
    const result = await v.checkOffer(TEST_ID, TEST_HASH)
    expect(result.status).toBe('unavailable')
  })

  test('queries with the agreement id as the entity key', async () => {
    const subgraph = mockSubgraph({ data: { offer: null } })
    const v = new OfferVerifier(subgraph, logger)
    await v.checkOffer(TEST_ID, TEST_HASH)
    expect((subgraph.query as jest.Mock).mock.calls[0][1]).toEqual({
      id: TEST_ID,
    })
  })
})
