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

const mockGetCollectionInfo = jest.fn()
const mockCollectEstimateGas = jest.fn()
const mockCollect = jest.fn()
const mockGetAgreement = jest.fn()

const mockContracts = {
  RecurringCollector: {
    getCollectionInfo: mockGetCollectionInfo,
    getAgreement: mockGetAgreement,
  },
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
} as any

const mockNetwork = {
  contracts: mockContracts,
  networkSubgraph: mockNetworkSubgraph,
  transactionManager: mockTransactionManager,
  specification: {
    indexerOptions: {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      dipperEndpoint: undefined,
      dipsCollectionSlippage: 5,
    },
    networkIdentifier: 'eip155:421614',
  },
  networkProvider: {
    getBlockNumber: jest.fn().mockResolvedValue(1000),
  },
} as any

const mockModels = {} as any

function createDipsManager(): DipsManager {
  return new DipsManager(logger, mockModels, mockNetwork, mockGraphNode, null)
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

  test('skips agreement when getCollectionInfo says not collectable', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        indexingAgreements: [{
          id: '0x00000000000000000000000000000001',
          allocationId: '0xaaaa',
          subgraphDeploymentId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          state: 1,
          lastCollectionAt: '1000',
          endsAt: '9999999999',
          maxInitialTokens: '1000000',
          maxOngoingTokensPerSecond: '100',
          tokensPerSecond: '50',
          tokensPerEntityPerSecond: '10',
          minSecondsPerCollection: 3600,
          maxSecondsPerCollection: 86400,
          canceledAt: '0',
        }],
      },
    })

    mockGetAgreement.mockResolvedValueOnce({
      dataService: '0x0000',
      payer: '0x0000',
      serviceProvider: '0x0000',
      acceptedAt: 1000n,
      lastCollectionAt: 1000n,
      endsAt: 9999999999n,
      maxInitialTokens: 1000000n,
      maxOngoingTokensPerSecond: 100n,
      minSecondsPerCollection: 3600,
      maxSecondsPerCollection: 86400,
      updateNonce: 0,
      canceledAt: 0n,
      state: 1,
    })
    mockGetCollectionInfo.mockResolvedValueOnce([false, 0n, 1])

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(mockExecuteTransaction).not.toHaveBeenCalled()
  })

  test('collects payment when agreement is collectable', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        indexingAgreements: [{
          id: '0x00000000000000000000000000000001',
          allocationId: '0xaaaa',
          subgraphDeploymentId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          state: 1,
          lastCollectionAt: '1000',
          endsAt: '9999999999',
          maxInitialTokens: '1000000',
          maxOngoingTokensPerSecond: '100',
          tokensPerSecond: '50',
          tokensPerEntityPerSecond: '10',
          minSecondsPerCollection: 3600,
          maxSecondsPerCollection: 86400,
          canceledAt: '0',
        }],
      },
    })

    mockGetAgreement.mockResolvedValueOnce({
      dataService: '0x0000',
      payer: '0x0000',
      serviceProvider: '0x0000',
      acceptedAt: 1000n,
      lastCollectionAt: 1000n,
      endsAt: 9999999999n,
      maxInitialTokens: 1000000n,
      maxOngoingTokensPerSecond: 100n,
      minSecondsPerCollection: 3600,
      maxSecondsPerCollection: 86400,
      updateNonce: 0,
      canceledAt: 0n,
      state: 1,
    })
    mockGetCollectionInfo.mockResolvedValueOnce([true, 7200n, 0])
    mockGraphNode.entityCount.mockResolvedValueOnce([500])
    mockGraphNode.blockHashFromNumber.mockResolvedValueOnce('0x' + 'ab'.repeat(32))
    mockGraphNode.proofOfIndexing.mockResolvedValueOnce('0x' + 'cd'.repeat(32))
    mockExecuteTransaction.mockResolvedValueOnce({ hash: '0xtxhash', status: 1 })

    const dm = createDipsManager()
    await dm.collectAgreementPayments()

    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1)
  })

  test('handles deterministic error gracefully', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        indexingAgreements: [{
          id: '0x00000000000000000000000000000001',
          allocationId: '0xaaaa',
          subgraphDeploymentId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          state: 1,
          lastCollectionAt: '1000',
          endsAt: '9999999999',
          maxInitialTokens: '1000000',
          maxOngoingTokensPerSecond: '100',
          tokensPerSecond: '50',
          tokensPerEntityPerSecond: '10',
          minSecondsPerCollection: 3600,
          maxSecondsPerCollection: 86400,
          canceledAt: '0',
        }],
      },
    })

    mockGetAgreement.mockResolvedValueOnce({
      dataService: '0x0000', payer: '0x0000', serviceProvider: '0x0000',
      acceptedAt: 1000n, lastCollectionAt: 1000n, endsAt: 9999999999n,
      maxInitialTokens: 1000000n, maxOngoingTokensPerSecond: 100n,
      minSecondsPerCollection: 3600, maxSecondsPerCollection: 86400,
      updateNonce: 0, canceledAt: 0n, state: 1,
    })
    mockGetCollectionInfo.mockResolvedValueOnce([true, 7200n, 0])
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
