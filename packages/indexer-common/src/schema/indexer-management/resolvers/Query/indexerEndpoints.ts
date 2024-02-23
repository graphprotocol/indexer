import { validateNetworkIdentifier } from 'indexer-common/src/parsers/validators'
import type { QueryResolvers } from './../../../types.generated'
import { Network } from 'indexer-common/src/network'

const URL_VALIDATION_TEST = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  test: (url: string) => `URL validation`,
  run: async (url: string) => {
    new URL(url)
  },
  possibleActions: (url: string) => [`Make sure ${url} is a valid URL`],
}

interface TestResult {
  test: string
  error: string | null
  possibleActions: string[]
}

interface Endpoint {
  url: string | null
  healthy: boolean
  protocolNetwork: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tests: any[]
}

interface Endpoints {
  service: Endpoint
  status: Endpoint
}

function defaultEndpoint(protocolNetwork: string): Endpoint {
  return {
    url: null as string | null,
    healthy: false,
    protocolNetwork,
    tests: [] as TestResult[],
  }
}
function defaultEndpoints(protocolNetwork: string): Endpoints {
  return {
    service: defaultEndpoint(protocolNetwork),
    status: defaultEndpoint(protocolNetwork),
  }
}

const testURL = async (
  url: string,
  tests: (typeof URL_VALIDATION_TEST)[],
): Promise<{ url: string; ok: boolean; tests: TestResult[] }> => {
  const results: TestResult[] = []

  for (const test of tests) {
    const cmd = test.test(url)

    try {
      await test.run(url)

      results.push({
        test: cmd,
        error: null,
        possibleActions: [],
      })
    } catch (e) {
      results.push({
        test: cmd,
        error: e.message,
        possibleActions: test.possibleActions(url),
      })
    }
  }

  return { url, tests: results, ok: !results.find((result) => result.error !== null) }
}

async function endpointForNetwork(network: Network): Promise<Endpoints> {
  const contracts = network.contracts
  const address = network.specification.indexerOptions.address
  const endpoints = defaultEndpoints(network.specification.networkIdentifier)
  const service = await contracts.serviceRegistry.services(address)
  if (service) {
    {
      const { url, tests, ok } = await testURL(service.url, [
        URL_VALIDATION_TEST,
        {
          test: (url) => `http get ${url}`,
          run: async (url) => {
            const response = await fetch(url)
            if (!response.ok) {
              throw new Error(
                `Returned status ${response.status}: ${
                  response.body ? response.body.toString() : 'No data returned'
                }`,
              )
            }
          },
          possibleActions: (url) => [
            `Make sure ${url} can be resolved and reached from this machine`,
            `Make sure the port of ${url} is set up correctly`,
            `Make sure the test command returns an HTTP status code < 400`,
          ],
        },
      ])

      endpoints.service.url = url
      endpoints.service.healthy = ok
      endpoints.service.tests = tests
    }

    {
      const statusURL = endpoints.service.url.endsWith('/')
        ? endpoints.service.url.substring(0, endpoints.service.url.length - 1) + '/status'
        : endpoints.service.url + '/status'

      const { url, tests, ok } = await testURL(statusURL, [
        URL_VALIDATION_TEST,
        {
          test: (url) => `http post ${url} query="{ indexingStatuses { subgraph } }"`,
          run: async (url) => {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query: '{ indexingStatuses { subgraph } }' }),
            })
            if (!response.ok) {
              throw new Error(
                `Returned status ${response.status}: ${
                  response.body ? response.body.toString() : 'No data returned'
                }`,
              )
            }
          },
          possibleActions: (url) => [
            `Make sure ${url} can be reached from this machine`,
            `Make sure the port of ${url} is set up correctly`,
            `Make sure ${url} is the /status endpoint of indexer-service`,
            `Make sure the test command returns an HTTP status code < 400`,
            `Make sure the test command returns a valid GraphQL response`,
          ],
        },
      ])

      endpoints.status.url = url
      endpoints.status.healthy = ok
      endpoints.status.tests = tests
    }
  }
  return endpoints
}

export const indexerEndpoints: NonNullable<QueryResolvers['indexerEndpoints']> = async (
  _parent,
  { protocolNetwork: unvalidatedProtocolNetwork },
  { multiNetworks, logger },
) => {
  if (!multiNetworks) {
    throw Error(
      'IndexerManagementClient must be in `network` mode to fetch indexer endpoints',
    )
  }

  const endpoints: Endpoints[] = []
  let networkIdentifier: string | null = null

  // Validate protocol network
  try {
    if (unvalidatedProtocolNetwork) {
      networkIdentifier = validateNetworkIdentifier(unvalidatedProtocolNetwork)
    }
  } catch (parseError) {
    throw new Error(
      `Invalid protocol network identifier: '${unvalidatedProtocolNetwork}'. Error: ${parseError}`,
    )
  }

  await multiNetworks.map(async (network) => {
    // Skip if this query asks for another protocol network
    if (
      networkIdentifier &&
      networkIdentifier !== network.specification.networkIdentifier
    ) {
      return
    }
    try {
      const networkEndpoints = await endpointForNetwork(network)
      endpoints.push(networkEndpoints)
    } catch (err) {
      // Ignore endpoints for this network
      logger?.warn(`Failed to detect service endpoints for network`, {
        err,
        protocolNetwork: network.specification.networkIdentifier,
      })
    }
  })
  return endpoints
}
