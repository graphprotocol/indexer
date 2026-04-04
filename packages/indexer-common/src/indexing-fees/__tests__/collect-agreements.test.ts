/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@graphprotocol/common-ts'
import { DipsManager } from '../dips'

const logger = {
  child: jest.fn().mockReturnThis(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
} as unknown as Logger

const mockQuery = jest.fn()
const mockNetworkSubgraph = { query: mockQuery } as any

const mockCollectEstimateGas = jest.fn()
const mockCollect = jest.fn()

const mockContracts = {
  SubgraphService: {
    collect: Object.assign(mockCollect, {
      estimateGas: mockCollectEstimateGas,
    }),
  },
} as any

const mockExecuteTransaction = jest.fn()
const mockTransactionManager = {
  executeTransaction: mockExecuteTransaction,
} as any

const mockGraphNode = {
  entityCount: jest.fn(),
  proofOfIndexing: jest.fn(),
  blockHashFromNumber: jest.fn(),
  subgraphFeatures: jest.fn().mockResolvedValue({ network: 'mainnet' }),
} as any

const mockNetwork = {
  contracts: mockContracts,
  networkSubgraph: mockNetworkSubgraph,
  transactionManager: mockTransactionManager,
  specification: {
    indexerOptions: {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      dipperEndpoint: undefined,
      dipsCollectionTarget: 50,
    },
    networkIdentifier: 'eip155:421614',
  },
  networkProvider: {
    getBlockNumber: jest.fn().mockResolvedValue(1000),
    getBlock: jest.fn().mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) }),
  },
} as any

const mockModels = {
  IndexingRule: {
    findAll: jest.fn().mockResolvedValue([]),
  },
} as any

function createDipsManager(): DipsManager {
  return new DipsManager(logger, mockModels, mockNetwork, mockGraphNode, null)
}

// Helper: agreement that was last collected long ago (ready to collect)
function makeReadyAgreement(id = '0x00000000000000000000000000000001') {
  return {
    id,
    allocationId: '0xaaaa',
    subgraphDeploymentId:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    state: 1,
    lastCollectionAt: '0', // never collected → always ready
    endsAt: '9999999999',
    maxInitialTokens: '1000000',
    maxOngoingTokensPerSecond: '100',
    tokensPerSecond: '50',
    tokensPerEntityPerSecond: '10',
    minSecondsPerCollection: 3600,
    maxSecondsPerCollection: 86400,
    canceledAt: '0',
  }
}

describe('DipsManager.collectAgreementPayments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('skips when no collectable agreements found', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [] },
    })

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(mockExecuteTransaction).not.toHaveBeenCalled()
  })

  test('skips agreement when tracker says not ready yet', async () => {
    const recentlyCollected = makeReadyAgreement()
    // Collected very recently — min is 3600, target at 50% is ~45000s
    recentlyCollected.lastCollectionAt = String(Math.floor(Date.now() / 1000) - 100)

    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [recentlyCollected] },
    })

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(mockExecuteTransaction).not.toHaveBeenCalled()
  })

  test('collects payment when agreement is ready', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [makeReadyAgreement()] },
    })

    mockGraphNode.entityCount.mockResolvedValueOnce([500])
    mockGraphNode.blockHashFromNumber.mockResolvedValueOnce('0x' + 'ab'.repeat(32))
    mockGraphNode.proofOfIndexing.mockResolvedValueOnce('0x' + 'cd'.repeat(32))
    mockExecuteTransaction.mockResolvedValueOnce({ hash: '0xtxhash', status: 1 })

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1)
  })

  test('updates tracker after successful collection', async () => {
    mockQuery
      .mockResolvedValueOnce({ data: { indexingAgreements: [makeReadyAgreement()] } })
      .mockResolvedValueOnce({ data: { indexingAgreements: [makeReadyAgreement()] } })

    mockGraphNode.entityCount.mockResolvedValue([500])
    mockGraphNode.blockHashFromNumber.mockResolvedValue('0x' + 'ab'.repeat(32))
    mockGraphNode.proofOfIndexing.mockResolvedValue('0x' + 'cd'.repeat(32))
    mockExecuteTransaction.mockResolvedValue({ hash: '0xtxhash', status: 1 })

    const dm = createDipsManager()

    // First call: collects
    await dm.collectAgreementPayments()
    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1)

    // Second call: tracker should skip (just collected)
    await dm.collectAgreementPayments()
    // Still only 1 call — second was skipped by tracker
    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1)
  })

  test('still attempts collection when POI is unavailable (best effort)', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [makeReadyAgreement()] },
    })

    mockGraphNode.entityCount.mockResolvedValueOnce([500])
    mockGraphNode.blockHashFromNumber.mockResolvedValueOnce('0x' + 'ab'.repeat(32))
    mockGraphNode.proofOfIndexing.mockResolvedValueOnce(null) // POI unavailable
    mockExecuteTransaction.mockResolvedValueOnce({ hash: '0xtxhash', status: 1 })

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    // Should log warning but still attempt collection with zero POI
    expect(logger.warn).toHaveBeenCalled()
    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1)
  })

  test('handles deterministic error gracefully', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { indexingAgreements: [makeReadyAgreement()] },
    })

    mockGraphNode.entityCount.mockResolvedValueOnce([500])
    mockGraphNode.blockHashFromNumber.mockResolvedValueOnce('0x' + 'ab'.repeat(32))
    mockGraphNode.proofOfIndexing.mockResolvedValueOnce('0x' + 'cd'.repeat(32))
    mockExecuteTransaction.mockRejectedValueOnce(
      Object.assign(new Error('revert'), { code: 'CALL_EXCEPTION' }),
    )

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(logger.warn).toHaveBeenCalled()
  })
})
