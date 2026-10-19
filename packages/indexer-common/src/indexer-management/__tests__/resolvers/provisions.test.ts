import type { IndexerManagementResolverContext } from '@graphprotocol/indexer-common'
import { CombinedError } from '@urql/core'
import provisions from '../../resolvers/provisions'

jest.mock(
  '@graphprotocol/indexer-common',
  () => ({ validateNetworkIdentifier: (value: string) => value }),
  { virtual: true },
)

const protocolNetwork = 'eip155:42161'

function context(result: object): IndexerManagementResolverContext {
  const network = {
    specification: {
      indexerOptions: { address: '0xindexer' },
      networkIdentifier: protocolNetwork,
    },
    isHorizon: { value: async () => true },
    contracts: {
      SubgraphService: { target: '0xservice' },
      HorizonStaking: { getIdleStake: async () => 42n },
    },
    networkSubgraph: { checkedQuery: async () => result },
  }
  return {
    logger: { debug: jest.fn(), trace: jest.fn(), error: jest.fn() },
    multiNetworks: {
      inner: { [protocolNetwork]: network },
      map: async (read: (value: typeof network) => Promise<unknown>) => ({
        [protocolNetwork]: await read(network),
      }),
    },
  } as unknown as IndexerManagementResolverContext
}

describe('provisions query', () => {
  it.each([undefined, { provisions: [] }])(
    'preserves an upstream error instead of reading unavailable or partial data: %j',
    async (data) => {
      const error = new CombinedError({
        graphQLErrors: ['bad indexers: BadResponse(400)'],
      })
      await expect(
        provisions.provisions({ protocolNetwork }, context({ data, error })),
      ).rejects.toBe(error)
    },
  )

  it('returns provision evidence after a successful query', async () => {
    const provision = {
      id: 'provision',
      tokensProvisioned: '100',
      tokensAllocated: '20',
      tokensThawing: '5',
      maxVerifierCut: '1',
      thawingPeriod: '10',
    }
    await expect(
      provisions.provisions(
        { protocolNetwork },
        context({ data: { provisions: [provision] } }),
      ),
    ).resolves.toEqual([
      {
        ...provision,
        indexer: '0xindexer',
        dataService: '0xservice',
        protocolNetwork,
        idleStake: '42',
      },
    ])
  })
})
