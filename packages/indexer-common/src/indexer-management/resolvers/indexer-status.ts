/* eslint-disable @typescript-eslint/ban-types */

import geohash from 'ngeohash'
import gql from 'graphql-tag'
import { IndexerManagementResolverContext } from '../client'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode, Network } from '@graphprotocol/indexer-common'
import { extractNetwork } from './utils'
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
    { protocolNetwork: unvalidateProtocolNetwork }: { protocolNetwork: string },
    { multiNetworks }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch indexer registration information',
      )
    }

    const network = extractNetwork(unvalidateProtocolNetwork, multiNetworks)
    const protocolNetwork = network.specification.networkIdentifier
    const address = network.specification.indexerOptions.address
    const contracts = network.contracts
    const registered = await contracts.serviceRegistry.isRegistered(address)

    if (registered) {
      const service = await contracts.serviceRegistry.services(address)
      return {
        address,
        protocolNetwork,
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
        protocolNetwork,
        location: null,
        __typename: 'IndexerRegistration',
      }
    }
  },

  indexerDeployments: async (
    _: {},
    { graphNode }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const result = await graphNode.indexingStatus([])
    return result.map((status) => ({
      ...status,
      subgraphDeployment: status.subgraphDeployment.ipfsHash,
    }))
  },

  indexerAllocations: async (
    { protocolNetwork }: { protocolNetwork: string },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch indexer allocations',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const address = network.specification.indexerOptions.address

    try {
      const result = await network.networkSubgraph.query(
        gql`
          query allocations($indexer: String!) {
            allocations(
              where: { indexer: $indexer, status: Active }
              first: 1000
              orderDirection: desc
            ) {
              id
              allocatedTokens
              createdAtEpoch
              closedAtEpoch
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
              }
            }
          }
        `,
        { indexer: address.toLocaleLowerCase() },
      )
      if (result.error) {
        throw result.error
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.data.allocations.map((allocation: any) => ({
        ...allocation,
        subgraphDeployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id)
          .ipfsHash,
        signalledTokens: allocation.subgraphDeployment.signalledTokens,
        stakedTokens: allocation.subgraphDeployment.stakedTokens,
        protocolNetwork: network.specification.networkIdentifier,
      }))
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      logger?.error(`Failed to query indexer allocations`, {
        err,
      })
      throw err
    }
  },

  indexerEndpoints: async (
    { protocolNetwork }: { protocolNetwork: string },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<Endpoints[] | null> => {
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch indexer endpoints',
      )
    }
    const endpoints: Endpoints[] = []
    await multiNetworks.map(async (network: Network) => {
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
  },
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
