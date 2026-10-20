import { NetworkSpecification } from '../network-specification'
import { loadTestYamlConfig } from '../parsers/test-utils'

const originalProvider = process.env.INDEXER_TEST_JRPC_PROVIDER_URL

afterAll(() => {
  if (originalProvider === undefined) {
    delete process.env.INDEXER_TEST_JRPC_PROVIDER_URL
  } else {
    process.env.INDEXER_TEST_JRPC_PROVIDER_URL = originalProvider
  }
})

test.each([
  [undefined, 'https://sepolia-rollup.arbitrum.io/rpc'],
  ['', 'https://sepolia-rollup.arbitrum.io/rpc'],
  ['https://rpc.example.test/', 'https://rpc.example.test/'],
])('test network configuration accepts provider %s', (provider, expected) => {
  if (provider === undefined) {
    delete process.env.INDEXER_TEST_JRPC_PROVIDER_URL
  } else {
    process.env.INDEXER_TEST_JRPC_PROVIDER_URL = provider
  }
  const config = NetworkSpecification.parse(loadTestYamlConfig())
  expect(config.networkProvider.url).toBe(expected)
})
