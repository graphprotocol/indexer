import { createLogger, Logger, parseGRT } from '@graphprotocol/common-ts'
import { AllocationManager } from '../allocations'
import { IndexerErrorCode } from '../../errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

const indexer = '0x0000000000000000000000000000000000000001'
const allocationId = '0x000000000000000000000000000000000000000a'
const protocolNetwork = 'eip155:42161'

// Only the on-chain allocation lookup is reached when preparing a resize, so the rest of
// the manager's dependencies can stay empty. The allocation holds 5,000 GRT unless a test
// says otherwise.
const buildManager = (
  logger: Logger,
  {
    closedAt = 0n,
    tokens = parseGRT('5000'),
  }: { closedAt?: bigint; tokens?: bigint } = {},
): { manager: AllocationManager; getAllocation: jest.Mock } => {
  const getAllocation = jest.fn().mockResolvedValue({ closedAt, indexer, tokens })
  const network = { contracts: { SubgraphService: { getAllocation } } }
  const manager = new AllocationManager(
    logger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    network as any,
  )
  return { manager, getAllocation }
}

describe('AllocationManager.prepareResizeParams amount checks', () => {
  let logger: Logger

  beforeAll(() => {
    logger = createLogger({
      name: 'resize-amount-test',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
  })

  it('accepts a resize down to 0 GRT', async () => {
    const { manager, getAllocation } = buildManager(logger)

    await expect(
      manager.prepareResizeParams(logger, allocationId, 0n, 1, protocolNetwork),
    ).resolves.toEqual({
      protocolNetwork,
      actionID: 1,
      allocationID: allocationId,
      newAmount: 0n,
      indexer,
    })
    expect(getAllocation).toHaveBeenCalledWith(allocationId)
  })

  it('accepts a positive amount', async () => {
    const { manager } = buildManager(logger)
    const newAmount = parseGRT('10000')

    await expect(
      manager.prepareResizeParams(logger, allocationId, newAmount, 2, protocolNetwork),
    ).resolves.toMatchObject({ newAmount })
  })

  it('rejects a negative amount with IE061 before reading the allocation', async () => {
    const { manager, getAllocation } = buildManager(logger)

    // The manager throws through the package's built entry point, so its error class is a
    // different copy from the one in src; the error code is what identifies it
    await expect(
      manager.prepareResizeParams(logger, allocationId, -1n, 3, protocolNetwork),
    ).rejects.toMatchObject({ code: IndexerErrorCode.IE061 })
    expect(getAllocation).not.toHaveBeenCalled()
  })

  it('rejects a resize to 0 on an allocation that already holds 0 GRT', async () => {
    const { manager } = buildManager(logger, { tokens: 0n })

    await expect(
      manager.prepareResizeParams(logger, allocationId, 0n, 5, protocolNetwork),
    ).rejects.toMatchObject({ code: IndexerErrorCode.IE061 })
  })

  it('rejects any resize to the size the allocation already has', async () => {
    const { manager } = buildManager(logger, { tokens: parseGRT('5000') })

    await expect(
      manager.prepareResizeParams(
        logger,
        allocationId,
        parseGRT('5000'),
        6,
        protocolNetwork,
      ),
    ).rejects.toMatchObject({ code: IndexerErrorCode.IE061 })
  })

  it('still rejects a resize to 0 on an allocation that has closed', async () => {
    const { manager } = buildManager(logger, { closedAt: 123n })

    await expect(
      manager.prepareResizeParams(logger, allocationId, 0n, 4, protocolNetwork),
    ).rejects.toMatchObject({ code: IndexerErrorCode.IE065 })
  })
})
