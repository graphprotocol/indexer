import { Address, Eventual, createLogger, createMetrics } from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationsResponse,
  SubgraphClient,
  QueryFeeModels,
  QueryResult,
  TapCollector,
  TapSubgraphResponse,
  TapTransaction,
  TransactionManager,
} from '@graphprotocol/indexer-common'
import { NetworkSpecification } from 'indexer-common/src/network-specification'
import { createMockAllocation } from '../../indexer-management/__tests__/helpers.test'
import { getCreateAddress } from 'ethers'
import { NetworkContracts as TapContracts } from '@semiotic-labs/tap-contracts-bindings'

const timeout = 30_000

// mock allocation subgraph responses
//
// firstPage // 1000
// secondPage // 1000
// thirdPage // 999
const allocations: Allocation[] = []
const from = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

for (let i = 0; i < 2999; i++) {
  const mockAllocation = createMockAllocation()
  allocations.push({
    ...mockAllocation,
    id: getCreateAddress({ from, nonce: i }) as Address,
  })
}

// mock transactions subgraph response
//
// firstPage // 1000
// secondPage // 1000
const transactions: TapTransaction[] = []
for (let i = 0; i < 2000; i++) {
  transactions.push({
    id: i.toString(),
    sender: { id: 'sender' },
    allocationID: 'allocation id',
    timestamp: i,
  })
}

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: never
let tapCollector: TapCollector

function paginateArray<T>(
  array: T[],
  getId: (item: T) => string,
  pageSize: number,
  lastId?: string,
): T[] {
  // Sort the array by ID to ensure consistent pagination.
  array.sort((a, b) => getId(a).localeCompare(getId(b)))

  // Find the index of the item with the given lastId.
  let startIndex = 0
  if (lastId) {
    startIndex = array.findIndex((item) => getId(item) === lastId) + 1
  }

  // Slice the array to return only the requested page size.
  return array.slice(startIndex, startIndex + pageSize)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockQueryNetworkSubgraph: jest.Mock<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockQueryTapSubgraph: jest.Mock<any, any, any>

jest.spyOn(TapCollector.prototype, 'startRAVProcessing').mockImplementation()
const setup = () => {
  const logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  const metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()

  mockQueryTapSubgraph = jest
    .fn()
    .mockImplementation(
      async (_, variables): Promise<QueryResult<TapSubgraphResponse>> => {
        console.log('MOCKING IMPLEMENTATION FOR TAP SUBGRAPH')
        const pageSize: number = variables.pageSize
        const lastId: string | undefined = variables.lastId

        const paginatedTransactions = paginateArray(
          transactions,
          (tx) => tx.id,
          pageSize,
          lastId,
        )

        return {
          data: {
            transactions: paginatedTransactions,
            _meta: {
              block: {
                hash: 'blockhash',
                timestamp: 100000,
              },
            },
          },
        }
      },
    )

  mockQueryNetworkSubgraph = jest
    .fn()
    .mockImplementation(
      async (_, variables): Promise<QueryResult<AllocationsResponse>> => {
        const pageSize: number = variables.pageSize
        const lastId: string | undefined = variables.lastId

        const paginatedAllocations = paginateArray(
          allocations,
          (allocation) => allocation.id,
          pageSize,
          lastId,
        )

        return {
          data: {
            allocations: paginatedAllocations,
            meta: {
              block: {
                hash: 'blockhash',
              },
            },
          },
        }
      },
    )
  {
    const transactionManager = null as unknown as TransactionManager
    const models = null as unknown as QueryFeeModels
    const tapContracts = null as unknown as TapContracts
    const allocations = null as unknown as Eventual<Allocation[]>
    const networkSpecification = {
      indexerOptions: { voucherRedemptionThreshold: 0, finalityTime: 0 },
      networkIdentifier: 'test',
    } as unknown as NetworkSpecification

    const tapSubgraph = {
      query: mockQueryTapSubgraph,
    } as unknown as SubgraphClient
    const networkSubgraph = {
      query: mockQueryNetworkSubgraph,
    } as unknown as SubgraphClient

    tapCollector = TapCollector.create({
      logger,
      metrics,
      transactionManager,
      models,
      tapContracts,
      allocations,
      networkSpecification,

      networkSubgraph,
      tapSubgraph,
    })
  }
}

// Skipped because it hits real RPC providers and uses up the API key.
// Skipping it works around this issue for now but we should turn it back on once we have a better solution.
describe.skip('TAP Pagination', () => {
  beforeAll(setup, timeout)
  test(
    'test `getAllocationsfromAllocationIds` pagination',
    async () => {
      {
        const allocations = await tapCollector['getAllocationsfromAllocationIds']([])
        expect(mockQueryNetworkSubgraph).toBeCalledTimes(3)
        expect(allocations.length).toEqual(2999)
      }
      mockQueryNetworkSubgraph.mockClear()

      const mockAllocation = createMockAllocation()
      allocations.push({
        ...mockAllocation,
        id: getCreateAddress({ from, nonce: 3000 }) as Address,
      })
      {
        const allocations = await tapCollector['getAllocationsfromAllocationIds']([])
        expect(mockQueryNetworkSubgraph).toBeCalledTimes(4)
        expect(allocations.length).toEqual(3000)
      }
    },
    timeout,
  )
  test(
    'test `findTransactionsForRavs` pagination',
    async () => {
      {
        const transactionsResponse = await tapCollector['findTransactionsForRavs']([])
        expect(mockQueryTapSubgraph).toBeCalledTimes(3)
        expect(transactionsResponse.transactions.length).toEqual(2000)
      }

      mockQueryTapSubgraph.mockClear()
      for (let i = 0; i < 500; i++) {
        transactions.push({
          id: i.toString(),
          sender: { id: 'sender' },
          allocationID: 'allocation id',
          timestamp: i,
        })
      }
      {
        const transactionsResponse = await tapCollector['findTransactionsForRavs']([])
        expect(mockQueryTapSubgraph).toBeCalledTimes(3)
        expect(transactionsResponse.transactions.length).toEqual(2500)
      }
    },
    timeout,
  )
})
