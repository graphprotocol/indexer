import { NetworkSpecification } from '../../network-specification'
import { loadTestYamlConfig } from '../test-utils'

describe('test network provider configuration', () => {
  const originalProviderUrl = process.env.INDEXER_TEST_JRPC_PROVIDER_URL

  afterEach(() => {
    if (originalProviderUrl === undefined) {
      delete process.env.INDEXER_TEST_JRPC_PROVIDER_URL
    } else {
      process.env.INDEXER_TEST_JRPC_PROVIDER_URL = originalProviderUrl
    }
  })

  test.each([undefined, ''])(
    'uses the public fallback for an absent or empty provider (%s)',
    (value) => {
      if (value === undefined) {
        delete process.env.INDEXER_TEST_JRPC_PROVIDER_URL
      } else {
        process.env.INDEXER_TEST_JRPC_PROVIDER_URL = value
      }
      // This is the same parse performed when the management test utility is
      // imported, before any test or RPC request can run. Fork PR secrets are empty.
      const parsed = NetworkSpecification.parse(loadTestYamlConfig())
      expect(parsed.networkProvider.url).toBe('https://sepolia-rollup.arbitrum.io/rpc')
    },
  )

  test('preserves an explicit provider URL', () => {
    const url = 'https://rpc.example.invalid/arbitrum-sepolia'
    process.env.INDEXER_TEST_JRPC_PROVIDER_URL = url
    expect(NetworkSpecification.parse(loadTestYamlConfig()).networkProvider.url).toBe(url)
  })

  test.each(['not-a-url', '   '])(
    'still rejects an invalid configured provider (%s)',
    (value) => {
      process.env.INDEXER_TEST_JRPC_PROVIDER_URL = value
      const result = NetworkSpecification.safeParse(loadTestYamlConfig())
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            code: 'invalid_string',
            validation: 'url',
            path: ['networkProvider', 'url'],
          }),
        )
      }
    },
  )
})
