import { DocumentNode, print } from 'graphql'
import {
  SubgraphFreshnessChecker,
  LoggerInterface,
  ProviderInterface,
  SubgraphQueryInterface,
} from '../subgraphs'
import { QueryResult } from '../network-subgraph'
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
