import { createLogger, Logger } from '@graphprotocol/common-ts'
import { AllocationManager } from '../allocations'
import { IndexingStatusCode } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

const indexer = '0x0000000000000000000000000000000000000001'
const allocationID = '0x000000000000000000000000000000000000000a'

const buildAllocationManager = (isOverAllocated: boolean) => {
  const subgraphService = {
    isOverAllocated: jest.fn().mockResolvedValue(isOverAllocated),
    interface: { encodeFunctionData: jest.fn((name: string) => name) },
    multicall: {
      populateTransaction: jest.fn(async (calls: string[]) => ({ data: calls })),
    },
    collect: {
      populateTransaction: jest.fn(async () => ({ data: 'collect-only' })),
    },
  }
  const network = { contracts: { SubgraphService: subgraphService } }
  const manager = new AllocationManager(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undefined as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undefined as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undefined as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    network as any,
  )
  return { manager, subgraphService }
}

describe('populateUnallocateTransaction', () => {
  let logger: Logger

  beforeAll(() => {
    logger = createLogger({
      name: 'unallocate-test',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
  })

  // An over-allocated collect resizes the allocation to zero rather than closing it,
  // so stopService is still needed to close it.
  it.each([false, true])(
    'multicalls collect and stopService when isOverAllocated is %s',
    async (isOverAllocated) => {
      const { manager, subgraphService } = buildAllocationManager(isOverAllocated)

      const tx = await manager.populateUnallocateTransaction(logger, {
        allocationID,
        poi: {
          poi: '0x' + '11'.repeat(32),
          publicPOI: '0x' + '22'.repeat(32),
          blockNumber: 1,
          indexingStatus: IndexingStatusCode.Healthy,
        },
        isLegacy: false,
        indexer,
        actionID: 1,
        protocolNetwork: 'eip155:42161',
      })

      expect(subgraphService.multicall.populateTransaction).toHaveBeenCalledWith([
        'collect',
        'stopService',
      ])
      expect(subgraphService.collect.populateTransaction).not.toHaveBeenCalled()
      expect(tx.data).toEqual(['collect', 'stopService'])
    },
  )
})
