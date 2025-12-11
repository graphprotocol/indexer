/* eslint-disable @typescript-eslint/ban-types */

import geohash from 'ngeohash'
import gql from 'graphql-tag'
import { IndexerManagementResolverContext } from '../client'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  indexerError,
  IndexerErrorCode,
  Network,
  validateNetworkIdentifier,
} from '@graphprotocol/indexer-common'
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

const URL_VALIDATION_TEST: Test = {
  test: () => `URL validation`,
  run: async (url) => {
    new URL(url)
  },
  possibleActions: (url) => [`Make sure ${url} is a valid URL`],
}

export default {
  indexerRegistration: async (
    { protocolNetwork: unvalidatedProtocolNetwork }: { protocolNetwork: string },
    { multiNetworks }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch indexer registration information',
      )
    }

    const network = extractNetwork(unvalidatedProtocolNetwork, multiNetworks)
    const protocolNetwork = network.specification.networkIdentifier
    const address = network.specification.indexerOptions.address
    const contracts = network.contracts

    const registrationInfo: RegistrationInfo[] = []

    const service = await contracts.SubgraphService.indexers(address)
    if (service.url.length > 0) {
      registrationInfo.push({
        address,
        protocolNetwork,
        url: service.url,
        location: geohash.decode(service.geoHash),
        registered: true,
        isLegacy: false,
        __typename: 'IndexerRegistration',
      })
    }

    if (registrationInfo.length === 0) {
      registrationInfo.push({
        address,
        url: null,
        registered: false,
        isLegacy: false,
        protocolNetwork,
        location: null,
        __typename: 'IndexerRegistration',
      })
    }

    return registrationInfo
  },

  indexerDeployments: async (
    _: { protocolNetwork: string | null },
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
      let lastId = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allAllocations: any[] = []
      for (;;) {
        const result = await network.networkSubgraph.checkedQuery(
          gql`
            query allocations($indexer: String!, $lastId: String!) {
              allocations(
                where: { indexer: $indexer, status: Active, id_gt: $lastId }
                first: 1000
                orderBy: id
                orderDirection: asc
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
          { indexer: address.toLocaleLowerCase(), lastId },
        )

        if (result.error) {
          logger.warning('Querying allocations failed', {
            error: result.error,
            lastId: lastId,
          })
          throw result.error
        }

        if (result.data.allocations.length === 0) {
          break
        }

        allAllocations.push(...result.data.allocations)
        lastId = result.data.allocations.slice(-1)[0].id
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return allAllocations.map((allocation: any) => ({
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
    { protocolNetwork: unvalidatedProtocolNetwork }: { protocolNetwork: string | null },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<Endpoints[] | null> => {
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

    await multiNetworks.map(async (network: Network) => {
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
  },
}

interface RegistrationInfo {
  address: string
  protocolNetwork: string
  url: string | null
  location: { latitude: number; longitude: number } | null
  registered: boolean
  __typename: 'IndexerRegistration'
  isLegacy: boolean
}

interface Endpoint {
  name: string | null
  url: string | null
  healthy: boolean
  protocolNetwork: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tests: any[]
  isLegacy: boolean
}

interface Endpoints {
  service: Endpoint
  status: Endpoint
}

function defaultEndpoint(
  protocolNetwork: string,
  name: string,
  isLegacy: boolean,
): Endpoint {
  return {
    name,
    url: null as string | null,
    healthy: false,
    protocolNetwork,
    tests: [] as TestResult[],
    isLegacy,
  }
}
function defaultEndpoints(protocolNetwork: string, isHorizon: boolean): Endpoints {
  return {
    service: defaultEndpoint(
      protocolNetwork,
      isHorizon ? 'service' : 'legacy-service',
      !isHorizon,
    ),
    status: defaultEndpoint(
      protocolNetwork,
      isHorizon ? 'status' : 'legacy-status',
      !isHorizon,
    ),
  }
}

async function endpointForNetwork(network: Network): Promise<Endpoints> {
  const contracts = network.contracts
  const address = network.specification.indexerOptions.address
  const endpoints = defaultEndpoints(network.specification.networkIdentifier, true)
  const service = await contracts.SubgraphService.indexers(address)
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
