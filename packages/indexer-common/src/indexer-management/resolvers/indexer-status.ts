/* eslint-disable @typescript-eslint/ban-types */

import geohash from 'ngeohash'

import { IndexerManagementResolverContext } from '../client'

interface Test {
  test: (url: string) => string
  run: (url: string) => Promise<void>
  possibleActions: (url: string) => string[]
}

interface TestResult {
  test: string
  error: string | null
  possibleActions: string[]
}

const testURL = async (
  url: string,
  tests: Test[],
): Promise<{ url: string; ok: boolean; tests: TestResult[] }> => {
  const results = []

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

const URL_VALIDATION_TEST: Test = {
  test: () => `URL validation`,
  run: async (url) => {
    new URL(url)
  },
  possibleActions: (url) => [`Make sure ${url} is a valid URL`],
}

export default {
  indexerRegistration: async (
    _: {},
    { address, contracts }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const registered = await contracts.serviceRegistry.isRegistered(address)

    if (registered) {
      const service = await contracts.serviceRegistry.services(address)
      return {
        address,
        url: service.url,
        location: geohash.decode(service.geohash),
        registered,
        __typename: 'IndexerRegistration',
      }
    } else {
      return {
        address,
        url: null,
        registered,
        location: null,
        __typename: 'IndexerRegistration',
      }
    }
  },

  indexerEndpoints: async (
    _: {},
    { address, contracts, logger }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const endpoints = {
      service: {
        url: null as string | null,
        healthy: false,
        tests: [] as TestResult[],
      },
      status: {
        url: null as string | null,
        healthy: false,
        tests: [] as TestResult[],
      },
      channels: {
        url: null as string | null,
        healthy: false,
        tests: [] as TestResult[],
      },
    }

    try {
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
            ? endpoints.service.url.substring(0, endpoints.service.url.length - 1) +
              '/status'
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

        {
          const channelsURL = endpoints.service.url.endsWith('/')
            ? endpoints.service.url.substring(0, endpoints.service.url.length - 1) +
              '/channel-messages-inbox'
            : endpoints.service.url + '/channel-messages-inbox'

          const { url, tests, ok } = await testURL(channelsURL, [
            URL_VALIDATION_TEST,
            {
              test: (url) => `echo '{}' | http post ${url}`,
              run: async (url) => {
                const response = await fetch(url, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ query: '{ indexingStatuses { subgraph } }' }),
                })

                // This message is expected to fail, but it shouldn't return a 404
                // or 401 or anything like that
                if (response.status !== 500) {
                  throw new Error(
                    `Expected response with status 500, got ${response.status}`,
                  )
                }
              },
              possibleActions: (url) => [
                `Make sure ${url} can be reached from this machine`,
                `Make sure the port of ${url} is set up correctly`,
                `Make sure ${url} is the /channel-messages-inbox endpoint of indexer-service`,
                `Make sure the test command returns an HTTP status code 500 (yes, that's right)`,
              ],
            },
          ])

          endpoints.channels.url = url
          endpoints.channels.healthy = ok
          endpoints.channels.tests = tests
        }
      }
    } catch (error) {
      // Return empty endpoints
      logger?.warn(`Failed to detect service endpoints`, {
        error: error.message || error,
      })
    }

    return endpoints
  },
}
