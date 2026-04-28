import { createLogger, Logger } from '@graphprotocol/common-ts'
import { assertNotOverAllocated } from '../over-allocation'
import { IndexerError, IndexerErrorCode } from '../../errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

const indexer = '0x0000000000000000000000000000000000000001'
const allocationId = '0x000000000000000000000000000000000000000a'
const subgraphServiceAddress = '0x00000000000000000000000000000000000000ff'

interface MockSubgraphService {
  isOverAllocated: jest.Mock
  allocationProvisionTracker: jest.Mock
  getDelegationRatio: jest.Mock
  target: string
}

interface MockHorizonStaking {
  getTokensAvailable: jest.Mock
}

const buildContracts = (
  overrides: {
    isOverAllocated?: boolean
    allocatedTokens?: bigint
    delegationRatio?: bigint
    tokensAvailable?: bigint
  } = {},
): {
  contracts: { SubgraphService: MockSubgraphService; HorizonStaking: MockHorizonStaking }
  subgraphService: MockSubgraphService
  horizonStaking: MockHorizonStaking
} => {
  const subgraphService: MockSubgraphService = {
    isOverAllocated: jest.fn().mockResolvedValue(overrides.isOverAllocated ?? false),
    allocationProvisionTracker: jest
      .fn()
      .mockResolvedValue(overrides.allocatedTokens ?? 0n),
    getDelegationRatio: jest.fn().mockResolvedValue(overrides.delegationRatio ?? 1n),
    target: subgraphServiceAddress,
  }
  const horizonStaking: MockHorizonStaking = {
    getTokensAvailable: jest.fn().mockResolvedValue(overrides.tokensAvailable ?? 0n),
  }
  return {
    contracts: { SubgraphService: subgraphService, HorizonStaking: horizonStaking },
    subgraphService,
    horizonStaking,
  }
}

describe('assertNotOverAllocated', () => {
  let logger: Logger

  beforeAll(() => {
    logger = createLogger({
      name: 'over-allocation-test',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
  })

  it('returns without throwing when the indexer is not over-allocated', async () => {
    const { contracts, subgraphService, horizonStaking } = buildContracts({
      isOverAllocated: false,
    })

    await expect(
      assertNotOverAllocated(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contracts as any,
        indexer,
        logger,
        allocationId,
      ),
    ).resolves.toBeUndefined()

    expect(subgraphService.isOverAllocated).toHaveBeenCalledWith(indexer)
    // None of the diagnostic reads should fire on the happy path — they are
    // only needed to compose the error message when over-allocation is true.
    expect(subgraphService.allocationProvisionTracker).not.toHaveBeenCalled()
    expect(subgraphService.getDelegationRatio).not.toHaveBeenCalled()
    expect(horizonStaking.getTokensAvailable).not.toHaveBeenCalled()
  })

  it('throws IE090 with the over-allocated delta when over-allocated', async () => {
    // 1000 GRT allocated, 600 GRT available => 400 GRT over.
    const { contracts } = buildContracts({
      isOverAllocated: true,
      allocatedTokens: 1000n * 10n ** 18n,
      delegationRatio: 2n,
      tokensAvailable: 600n * 10n ** 18n,
    })

    let captured: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await assertNotOverAllocated(contracts as any, indexer, logger, allocationId)
    } catch (err) {
      captured = err
    }

    expect(captured).toBeInstanceOf(IndexerError)
    const err = captured as IndexerError
    expect(err.code).toBe(IndexerErrorCode.IE090)
    // Spot-check the cause string contains the GRT delta and the actionable
    // hint pointing operators at the close path (which still collects rewards).
    const cause = String(err.cause)
    expect(cause).toContain('400.0')
    expect(cause).toContain('graph indexer allocations close')
  })

  it('passes the SubgraphService address as the verifier to getTokensAvailable', async () => {
    const { contracts, horizonStaking } = buildContracts({
      isOverAllocated: true,
      allocatedTokens: 100n,
      delegationRatio: 3n,
      tokensAvailable: 50n,
    })

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertNotOverAllocated(contracts as any, indexer, logger, allocationId),
    ).rejects.toBeInstanceOf(IndexerError)

    expect(horizonStaking.getTokensAvailable).toHaveBeenCalledWith(
      indexer,
      subgraphServiceAddress,
      3n,
    )
  })

  it('clamps the over-allocated amount to zero if reads race to a negative delta', async () => {
    // tokensAvailable > allocatedTokens shouldn't happen when isOverAllocated
    // is true, but the three reads aren't atomic; defend against a negative
    // bigint formatting into the error message.
    const { contracts } = buildContracts({
      isOverAllocated: true,
      allocatedTokens: 100n,
      delegationRatio: 1n,
      tokensAvailable: 200n,
    })

    let captured: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await assertNotOverAllocated(contracts as any, indexer, logger, allocationId)
    } catch (err) {
      captured = err
    }

    const err = captured as IndexerError
    expect(err.code).toBe(IndexerErrorCode.IE090)
    const cause = String(err.cause)
    expect(cause).toContain('0.0 GRT')
    expect(cause).not.toContain('-')
  })
})
