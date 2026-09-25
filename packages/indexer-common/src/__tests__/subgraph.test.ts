import axios, { AxiosInstance } from 'axios'
import { createLogger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { DocumentNode, print } from 'graphql'
import {
  SubgraphFreshnessChecker,
  LoggerInterface,
  ProviderInterface,
  SubgraphQueryInterface,
} from '../subgraphs'
import { QueryResult, SubgraphClient } from '../subgraph-client'
import { GraphNode } from '../graph-node'
import gql from 'graphql-tag'
import { mergeSelectionSets } from '../utils'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const mockProvider: ProviderInterface & any = {
  getBlockNumber: jest.fn(),
}

export const mockLogger: LoggerInterface & any = {
  trace: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}

const mockSubgraph: SubgraphQueryInterface & any = {
  query: jest.fn(),
}

const testSubgraphQuery: DocumentNode = gql`
  query TestQuery {
    foo {
      id
    }
  }
`

function mockQueryResult(blockNumber: number): QueryResult<any> & {
  data: { _meta: { block: { number: number } } }
} {
  return {
    data: {
      foo: {
        id: 1,
      },
      _meta: {
        block: {
          number: blockNumber,
        },
      },
    },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const blockNumberQuery = gql`
  {
    _meta {
      block {
        number
      }
    }
  }
`

describe('mergeSelectionSets function tests', () => {
  it('can merge two GraphQL queries', () => {
    const firstQuery = gql`
      query Foo {
        graphNetworks(first: 5) {
          id
          controller
          graphToken
          epochManager
        }
        graphAccounts(first: 5) {
          id
          names {
            id
          }
          defaultName {
            id
          }
          createdAt
        }
      }
    `
    const expected = gql`
      query Foo {
        graphNetworks(first: 5) {
          id
          controller
          graphToken
          epochManager
        }
        graphAccounts(first: 5) {
          id
          names {
            id
          }
          defaultName {
            id
          }
          createdAt
        }
        _meta {
          block {
            number
          }
        }
      }
    `
    const result = mergeSelectionSets(firstQuery, blockNumberQuery)
    expect(result.definitions).toStrictEqual(expected.definitions)
    expect(print(result)).toEqual(print(expected))
  })

  it("doesn't mutate its input", () => {
    const expectedMergedQuery = gql`
      query TestQuery {
        foo {
          id
        }
        _meta {
          block {
            number
          }
        }
      }
    `
    let result: DocumentNode
    // Repetition required to test `mergeSelectionSets` doesn't mutate its input
    for (let i = 0; i < 3; i++) {
      result = mergeSelectionSets(testSubgraphQuery, blockNumberQuery)
    }
    expect(result!.definitions).toStrictEqual(expectedMergedQuery.definitions)
    expect(print(result!)).toEqual(print(expectedMergedQuery))
  })
})

describe('SubgraphFreshnessChecker', () => {
  beforeEach(jest.resetAllMocks)

  describe('checkedQuery method', () => {
    beforeEach(jest.resetAllMocks)

    it('should throw an error if max retries reached', async () => {
      const checker = new SubgraphFreshnessChecker(
        'Test Subgraph',
        mockProvider,
        10,
        10,
        mockLogger,
        1,
      )

      // Mocks never change value in this test, so the network will always be 100 blocks ahead and
      // the checked query will timeout.f
      mockProvider.getBlockNumber.mockResolvedValue(242)
      mockSubgraph.query.mockResolvedValue(mockQueryResult(100))

      await expect(checker.checkedQuery(mockSubgraph, testSubgraphQuery)).rejects.toThrow(
        'Max retries reached for Test Subgraph freshness check',
      )

      expect(mockLogger.trace).toHaveBeenCalledWith(
        expect.stringContaining('Performing subgraph freshness check'),
        {
          blockDistance: 142,
          freshnessThreshold: 10,
          latestIndexedBlock: 100,
          latestNetworkBlock: 242,
          retriesLeft: 1,
          subgraph: 'Test Subgraph',
        },
      )
    })

    it('should return query result if the subgraph is fresh', async () => {
      const checker = new SubgraphFreshnessChecker(
        'Test Subgraph',
        mockProvider,
        10,
        10,
        mockLogger,
        1,
      )

      mockProvider.getBlockNumber.mockResolvedValue(105)
      mockSubgraph.query.mockResolvedValue(mockQueryResult(100))

      await expect(
        checker.checkedQuery(mockSubgraph, testSubgraphQuery),
      ).resolves.toEqual(mockQueryResult(100))

      expect(mockLogger.trace).toHaveBeenCalledWith(
        expect.stringContaining('Performing subgraph freshness check'),
        {
          blockDistance: 5,
          freshnessThreshold: 10,
          latestIndexedBlock: 100,
          latestNetworkBlock: 105,
          retriesLeft: 1,
          subgraph: 'Test Subgraph',
        },
      )
    })

    it('should return query result if the subgraph becomes fresh after retries', async () => {
      const checker = new SubgraphFreshnessChecker(
        'Test Subgraph',
        mockProvider,
        10,
        100,
        mockLogger,
        2,
      )

      // Advance the network by ten blocks between calls
      mockProvider.getBlockNumber.mockResolvedValueOnce(150).mockResolvedValueOnce(160)

      // Advance the subgraph by 20 blocks between calls
      // The first call should trigger a retry, which then shuld succeed
      mockSubgraph.query
        .mockResolvedValueOnce(mockQueryResult(130))
        .mockResolvedValueOnce(mockQueryResult(150))

      const result = await checker.checkedQuery(mockSubgraph, testSubgraphQuery)
      expect(result).toEqual(mockQueryResult(150))

      // It should log this on retry
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Test Subgraph is not fresh. Sleeping for 100 ms before retrying',
        ),
        {
          blockDistance: 20,
          freshnessThreshold: 10,
          latestIndexedBlock: 130,
          latestNetworkBlock: 150,
          retriesLeft: 2,
          subgraph: 'Test Subgraph',
        },
      )
      // It should log this on success
      expect(mockLogger.trace.mock.calls).toContainEqual(
        expect.objectContaining([
          'Test Subgraph is fresh',
          {
            blockDistance: 10,
            freshnessThreshold: 10,
            latestIndexedBlock: 150,
            latestNetworkBlock: 160,
            retriesLeft: 1,
            subgraph: 'Test Subgraph',
          },
        ]),
      )
    })
  })
})

describe('SubgraphClient deployment monitoring', () => {
  const logger = createLogger({
    name: 'Subgraph client tests',
    async: false,
    level: 'error',
  })
  const deployment = new SubgraphDeploymentID(
    'Qmd9nZKCH8UZU1pBzk7G8ECJr3jX3a2vAf3vowuTwFvrQg',
  )
  const unsynced = { synced: false, health: 'healthy', chains: [] }
  const synced = { synced: true, health: 'healthy', chains: [] }
  const unhealthy = { synced: true, health: 'unhealthy', chains: [] }
  let indexingStatus: jest.Mock
  let graphNode: GraphNode
  let remotePost: jest.Mock
  let localPost: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    indexingStatus = jest.fn()
    remotePost = jest.fn().mockResolvedValue({ data: 'remote' })
    localPost = jest.fn().mockResolvedValue({ data: 'local' })
    jest
      .spyOn(axios, 'create')
      .mockReturnValue({ post: remotePost } as unknown as AxiosInstance)
    graphNode = {
      indexingStatus,
      getQueryClient: jest.fn().mockReturnValue({ post: localPost }),
      getQueryEndpoint: jest.fn().mockReturnValue('http://local'),
    } as unknown as GraphNode
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('selects the local deployment when it syncs and retains its status on a failed poll', async () => {
    indexingStatus
      .mockResolvedValueOnce([unsynced])
      .mockResolvedValueOnce([synced])
      .mockRejectedValueOnce(new Error('status unavailable'))
      .mockResolvedValueOnce([unhealthy])

    const client = await SubgraphClient.create({
      logger,
      name: 'Test Subgraph',
      endpoint: 'http://remote',
      deployment: { graphNode, deployment },
    })
    await jest.advanceTimersByTimeAsync(0)

    await expect(client.queryRaw('{}')).resolves.toEqual({ data: 'remote' })
    await jest.advanceTimersByTimeAsync(60_000)
    await expect(client.queryRaw('{}')).resolves.toEqual({ data: 'local' })

    await jest.advanceTimersByTimeAsync(60_000)
    await expect(client.queryRaw('{}')).resolves.toEqual({ data: 'local' })

    await jest.advanceTimersByTimeAsync(60_000)
    await expect(client.queryRaw('{}')).resolves.toEqual({ data: 'remote' })
    expect(remotePost).toHaveBeenCalledTimes(2)
    expect(localPost).toHaveBeenCalledTimes(2)
  })

  it('waits for a deployment-only client to sync', async () => {
    indexingStatus.mockResolvedValueOnce([unsynced]).mockResolvedValueOnce([synced])

    let created = false
    const clientPromise = SubgraphClient.create({
      logger,
      name: 'Test Subgraph',
      deployment: { graphNode, deployment },
    }).then((client) => {
      created = true
      return client
    })

    await jest.advanceTimersByTimeAsync(0)
    expect(created).toBe(false)

    await jest.advanceTimersByTimeAsync(60_000)
    const client = await clientPromise
    expect(created).toBe(true)
    await expect(client.queryRaw('{}')).resolves.toEqual({ data: 'local' })
  })
})
