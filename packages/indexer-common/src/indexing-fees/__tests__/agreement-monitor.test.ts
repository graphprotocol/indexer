import { fetchCollectableAgreements, SubgraphIndexingAgreement } from '../agreement-monitor'

const mockQuery = jest.fn()
const mockNetworkSubgraph = { query: mockQuery } as any

const INDEXER_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'

describe('fetchCollectableAgreements', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns agreements in Accepted and CanceledByPayer states', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        indexingAgreements: [
          {
            id: '0x00000000000000000000000000000001',
            allocationId: '0xaaaa',
            subgraphDeploymentId: '0xbbbb',
            state: 1,
            lastCollectionAt: '1000',
            endsAt: '9999999999',
            maxInitialTokens: '1000000',
            maxOngoingTokensPerSecond: '100',
            tokensPerSecond: '50',
            tokensPerEntityPerSecond: '10',
            minSecondsPerCollection: 3600,
            maxSecondsPerCollection: 86400,
            canceledAt: '0',
          },
        ],
      },
    })

    const result = await fetchCollectableAgreements(
      mockNetworkSubgraph,
      INDEXER_ADDRESS,
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('0x00000000000000000000000000000001')
    expect(result[0].state).toBe(1)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  test('returns empty array when no agreements exist', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [] },
    })

    const result = await fetchCollectableAgreements(
      mockNetworkSubgraph,
      INDEXER_ADDRESS,
    )

    expect(result).toHaveLength(0)
  })

  test('paginates through large result sets', async () => {
    // First page: 1000 results
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `0x${i.toString(16).padStart(32, '0')}`,
      allocationId: '0xaaaa',
      subgraphDeploymentId: '0xbbbb',
      state: 1,
      lastCollectionAt: '1000',
      endsAt: '9999999999',
      maxInitialTokens: '1000000',
      maxOngoingTokensPerSecond: '100',
      tokensPerSecond: '50',
      tokensPerEntityPerSecond: '10',
      minSecondsPerCollection: 3600,
      maxSecondsPerCollection: 86400,
      canceledAt: '0',
    }))
    // Second page: 1 result
    const page2 = [{
      id: '0x' + 'f'.repeat(32),
      allocationId: '0xaaaa',
      subgraphDeploymentId: '0xbbbb',
      state: 1,
      lastCollectionAt: '1000',
      endsAt: '9999999999',
      maxInitialTokens: '1000000',
      maxOngoingTokensPerSecond: '100',
      tokensPerSecond: '50',
      tokensPerEntityPerSecond: '10',
      minSecondsPerCollection: 3600,
      maxSecondsPerCollection: 86400,
      canceledAt: '0',
    }]

    mockQuery
      .mockResolvedValueOnce({ data: { indexingAgreements: page1 } })
      .mockResolvedValueOnce({ data: { indexingAgreements: page2 } })

    const result = await fetchCollectableAgreements(
      mockNetworkSubgraph,
      INDEXER_ADDRESS,
    )

    expect(result).toHaveLength(1001)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})
