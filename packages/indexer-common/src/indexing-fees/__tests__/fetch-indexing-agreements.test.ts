/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchIndexingAgreements } from '../agreement-monitor'

const mockQuery = jest.fn()
const mockSubgraph = { query: mockQuery } as any

const agreement = (id: string) => ({
  id,
  payer: '0xpayer',
  indexer: '0xindexer',
  allocationId: '0xalloc',
  subgraphDeploymentId: '0xdeadbeef',
  state: 'Accepted',
  acceptedAt: '100',
  lastCollectionAt: '200',
  endsAt: '300',
  tokensPerSecond: '1',
  tokensCollected: '500',
  canceledAt: '0',
  canceledBy: '0x0000000000000000000000000000000000000000',
})

describe('fetchIndexingAgreements', () => {
  beforeEach(() => mockQuery.mockReset())

  it('filters by indexer (lowercased) and returns the agreements', async () => {
    mockQuery.mockResolvedValueOnce({ data: { indexingAgreements: [agreement('0x01')] } })

    const result = await fetchIndexingAgreements(mockSubgraph, '0xAbC')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('0x01')
    const [, variables] = mockQuery.mock.calls[0]
    expect(variables.where.indexer).toBe('0xabc')
    expect(variables.where.state).toBeUndefined()
  })

  it('passes the state filter through when provided', async () => {
    mockQuery.mockResolvedValueOnce({ data: { indexingAgreements: [] } })

    await fetchIndexingAgreements(mockSubgraph, '0xabc', { state: 'CanceledByPayer' })

    const [, variables] = mockQuery.mock.calls[0]
    expect(variables.where.state).toBe('CanceledByPayer')
  })

  it('paginates until a short page is returned', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) =>
      agreement('0x' + (i + 1).toString(16).padStart(2, '0')),
    )
    mockQuery
      .mockResolvedValueOnce({ data: { indexingAgreements: firstPage } })
      .mockResolvedValueOnce({ data: { indexingAgreements: [agreement('0xffff')] } })

    const result = await fetchIndexingAgreements(mockSubgraph, '0xabc')

    expect(result).toHaveLength(1001)
    expect(mockQuery.mock.calls[1][1].lastId).toBe(firstPage[999].id)
  })

  it('throws when the subgraph returns an error', async () => {
    mockQuery.mockResolvedValueOnce({ error: new Error('boom') })

    await expect(fetchIndexingAgreements(mockSubgraph, '0xabc')).rejects.toThrow('boom')
  })
})
