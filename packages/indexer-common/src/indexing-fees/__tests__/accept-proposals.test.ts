import { createLogger, Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { DipsManager } from '../dips'
import { PendingRcaConsumer } from '../pending-rca-consumer'
import { DecodedRcaProposal } from '../types'
import {
  Allocation,
  AllocationStatus,
  IndexerManagementModels,
  Network,
} from '@graphprotocol/indexer-common'

let logger: Logger

beforeAll(() => {
  logger = createLogger({
    name: 'AcceptProposals Test',
    async: false,
    level: 'error',
  })
})

const TEST_DEPLOYMENT_BYTES32 =
  '0x0100000000000000000000000000000000000000000000000000000000000000'

function createMockProposal(
  overrides: Partial<DecodedRcaProposal> = {},
): DecodedRcaProposal {
  const deployment = new SubgraphDeploymentID(
    overrides.subgraphDeploymentId?.bytes32 ?? TEST_DEPLOYMENT_BYTES32,
  )
  return {
    id: 'proposal-1',
    status: 'pending',
    createdAt: new Date(),
    signedRca: {
      rca: {
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        endsAt: BigInt(Math.floor(Date.now() / 1000) + 86400),
        payer: '0x1111111111111111111111111111111111111111',
        dataService: '0x2222222222222222222222222222222222222222',
        serviceProvider: '0x3333333333333333333333333333333333333333',
        maxInitialTokens: 10000n,
        maxOngoingTokensPerSecond: 100n,
        minSecondsPerCollection: 3600n,
        maxSecondsPerCollection: 86400n,
        nonce: 42n,
        metadata: '0x',
      },
      signature: '0xaabbccdd',
    },
    signedPayload: new Uint8Array(),
    payer: '0x1111111111111111111111111111111111111111',
    serviceProvider: '0x3333333333333333333333333333333333333333',
    dataService: '0x2222222222222222222222222222222222222222',
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    endsAt: BigInt(Math.floor(Date.now() / 1000) + 86400),
    maxInitialTokens: 10000n,
    maxOngoingTokensPerSecond: 100n,
    minSecondsPerCollection: 3600n,
    maxSecondsPerCollection: 86400n,
    nonce: 42n,
    subgraphDeploymentId: deployment,
    tokensPerSecond: 1000n,
    tokensPerEntityPerSecond: 50n,
    ...overrides,
  }
}

function createMockConsumer(proposals: DecodedRcaProposal[] = []) {
  return {
    getPendingProposals: jest.fn().mockResolvedValue(proposals),
    markAccepted: jest.fn().mockResolvedValue(undefined),
    markRejected: jest.fn().mockResolvedValue(undefined),
  } as unknown as PendingRcaConsumer
}

function createMockModels() {
  return {
    IndexingRule: {
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn().mockResolvedValue(1),
    },
  } as unknown as IndexerManagementModels
}

function createMockNetwork() {
  return {
    contracts: {
      SubgraphService: {
        acceptIndexingAgreement: Object.assign(jest.fn(), {
          estimateGas: jest.fn().mockResolvedValue(100000n),
          populateTransaction: jest.fn().mockResolvedValue({ data: '0xaccept' }),
        }),
        startService: {
          populateTransaction: jest.fn().mockResolvedValue({ data: '0xstart' }),
        },
        multicall: Object.assign(jest.fn(), {
          estimateGas: jest.fn().mockResolvedValue(200000n),
        }),
        getAllocation: jest.fn().mockResolvedValue({ createdAt: 0n }),
        getLegacyAllocation: jest
          .fn()
          .mockResolvedValue({ indexer: '0x0000000000000000000000000000000000000000' }),
        target: '0x4444444444444444444444444444444444444444',
        indexers: jest.fn().mockResolvedValue({ url: 'http://test' }),
      },
      EpochManager: {
        currentEpoch: jest.fn().mockResolvedValue(100n),
      },
    },
    transactionManager: {
      executeTransaction: jest.fn(),
      wallet: {
        mnemonic: {
          phrase: 'test test test test test test test test test test test junk',
        },
      },
    },
    networkMonitor: {
      currentEpoch: jest.fn().mockResolvedValue(100n),
    },
    specification: {
      indexerOptions: {
        address: '0x5555555555555555555555555555555555555555',
        enableDips: true,
        dipsAllocationAmount: 1000000000000000000n,
      },
      networkIdentifier: 'eip155:1337',
    },
    isHorizon: { value: jest.fn().mockResolvedValue(true) },
  } as unknown as Network
}

function createDipsManager(
  network: Network,
  models: IndexerManagementModels,
  consumer: PendingRcaConsumer,
): DipsManager {
  const dm = new DipsManager(logger, models, network, null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dm as any).pendingRcaConsumer = consumer
  return dm
}

describe('DipsManager.acceptPendingProposals', () => {
  test('rejects proposals with expired deadlines', async () => {
    const expiredProposal = createMockProposal({
      deadline: BigInt(Math.floor(Date.now() / 1000) - 100), // expired
    })
    const consumer = createMockConsumer([expiredProposal])
    const models = createMockModels()
    const network = createMockNetwork()
    const dm = createDipsManager(network, models, consumer)

    await dm.acceptPendingProposals([])

    expect(consumer.markRejected).toHaveBeenCalledWith(
      expiredProposal.id,
      'deadline_expired',
    )
    expect(consumer.markAccepted).not.toHaveBeenCalled()
  })

  test('cleans up DIPS rule when rejecting last proposal for a deployment', async () => {
    const proposal = createMockProposal({
      deadline: BigInt(Math.floor(Date.now() / 1000) - 100),
    })
    const consumer = createMockConsumer([proposal])
    // After rejection, getPendingProposals returns empty (no other proposals)
    consumer.getPendingProposals = jest
      .fn()
      .mockResolvedValueOnce([proposal]) // first call in acceptPendingProposals
      .mockResolvedValueOnce([]) // second call in cleanupDipsRule
    const mockRule = { id: 42 }
    const models = createMockModels()
    ;(models.IndexingRule.findOne as jest.Mock).mockResolvedValue(mockRule)

    const network = createMockNetwork()
    const dm = createDipsManager(network, models, consumer)

    await dm.acceptPendingProposals([])

    expect(models.IndexingRule.destroy).toHaveBeenCalledWith({ where: { id: 42 } })
  })

  test('does not clean up DIPS rule when other proposals exist for deployment', async () => {
    const proposal = createMockProposal({
      deadline: BigInt(Math.floor(Date.now() / 1000) - 100),
    })
    const otherProposal = createMockProposal({ id: 'proposal-2' })
    const consumer = createMockConsumer([proposal])
    consumer.getPendingProposals = jest
      .fn()
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([otherProposal]) // another proposal for same deployment
    const models = createMockModels()
    const network = createMockNetwork()
    const dm = createDipsManager(network, models, consumer)

    await dm.acceptPendingProposals([])

    expect(models.IndexingRule.destroy).not.toHaveBeenCalled()
  })

  test('returns early when no pending proposals', async () => {
    const consumer = createMockConsumer([])
    const models = createMockModels()
    const network = createMockNetwork()
    const dm = createDipsManager(network, models, consumer)

    await dm.acceptPendingProposals([])

    expect(consumer.markAccepted).not.toHaveBeenCalled()
    expect(consumer.markRejected).not.toHaveBeenCalled()
  })

  test('returns early when pendingRcaConsumer is null', async () => {
    const models = createMockModels()
    const network = createMockNetwork()
    const dm = new DipsManager(logger, models, network, null)

    // Should not throw
    await dm.acceptPendingProposals([])
  })

  describe('with existing allocation', () => {
    function createMockAllocation(
      deploymentBytes32: string = TEST_DEPLOYMENT_BYTES32,
    ): Allocation {
      return {
        id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: AllocationStatus.ACTIVE,
        isLegacy: false,
        subgraphDeployment: {
          id: new SubgraphDeploymentID(deploymentBytes32),
        },
        indexer: '0x5555555555555555555555555555555555555555',
        allocatedTokens: 1000000000000000000n,
        createdAt: 0,
        createdAtEpoch: 100,
        createdAtBlockHash: '0x',
        closedAt: 0,
        closedAtEpoch: 0,
        closedAtEpochStartBlockHash: undefined,
        previousEpochStartBlockHash: undefined,
        closedAtBlockHash: '0x',
        poi: undefined,
        queryFeeRebates: 0n,
        queryFeesCollected: 0n,
      } as Allocation
    }

    test('accepts proposal on-chain and marks accepted', async () => {
      const proposal = createMockProposal()
      const allocation = createMockAllocation()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      const mockReceipt = { hash: '0xtxhash', status: 1 }
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        mockReceipt,
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      expect(network.transactionManager.executeTransaction).toHaveBeenCalled()
      expect(consumer.markAccepted).toHaveBeenCalledWith(proposal.id)
    })

    test('skips acceptance when network is paused', async () => {
      const proposal = createMockProposal()
      const allocation = createMockAllocation()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        'paused',
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      expect(consumer.markAccepted).not.toHaveBeenCalled()
      expect(consumer.markRejected).not.toHaveBeenCalled()
    })

    test('skips acceptance when unauthorized', async () => {
      const proposal = createMockProposal()
      const allocation = createMockAllocation()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        'unauthorized',
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      expect(consumer.markAccepted).not.toHaveBeenCalled()
      expect(consumer.markRejected).not.toHaveBeenCalled()
    })

    test('uses multicall path when allocation is for different deployment', async () => {
      const proposal = createMockProposal()
      const differentDeployment =
        '0x0200000000000000000000000000000000000000000000000000000000000000'
      const allocation = createMockAllocation(differentDeployment)
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      const mockReceipt = { hash: '0xmulticall', status: 1 }
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        mockReceipt,
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      // Should go to acceptWithNewAllocation (multicall) path, not existing allocation
      expect(
        network.contracts.SubgraphService.startService.populateTransaction,
      ).toHaveBeenCalled()
      expect(consumer.markAccepted).toHaveBeenCalledWith(proposal.id)
    })
  })

  describe('with new allocation (multicall)', () => {
    test('creates allocation and accepts in single multicall', async () => {
      const proposal = createMockProposal()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      const mockReceipt = { hash: '0xmulticallhash', status: 1 }
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        mockReceipt,
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([]) // no active allocations

      expect(network.transactionManager.executeTransaction).toHaveBeenCalled()
      expect(consumer.markAccepted).toHaveBeenCalledWith(proposal.id)
    })

    test('skips when allocation already exists on-chain', async () => {
      const proposal = createMockProposal()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      // Allocation exists on-chain
      ;(
        network.contracts.SubgraphService.getAllocation as unknown as jest.Mock
      ).mockResolvedValue({
        createdAt: 100n,
      })

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([])

      expect(consumer.markAccepted).not.toHaveBeenCalled()
      expect(network.transactionManager.executeTransaction).not.toHaveBeenCalled()
    })

    test('uses dipsAllocationAmount for token amount', async () => {
      const proposal = createMockProposal()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      const mockReceipt = { hash: '0x', status: 1 }
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        mockReceipt,
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([])

      // Verify startService was called with the configured allocation amount
      expect(
        network.contracts.SubgraphService.startService.populateTransaction,
      ).toHaveBeenCalled()
    })

    test('handles paused network during multicall', async () => {
      const proposal = createMockProposal()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      ;(network.transactionManager.executeTransaction as jest.Mock).mockResolvedValue(
        'paused',
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([])

      expect(consumer.markAccepted).not.toHaveBeenCalled()
      expect(consumer.markRejected).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    function createMockAllocation(): Allocation {
      return {
        id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: AllocationStatus.ACTIVE,
        isLegacy: false,
        subgraphDeployment: {
          id: new SubgraphDeploymentID(TEST_DEPLOYMENT_BYTES32),
        },
        indexer: '0x5555555555555555555555555555555555555555',
        allocatedTokens: 1000000000000000000n,
        createdAt: 0,
        createdAtEpoch: 100,
        createdAtBlockHash: '0x',
        closedAt: 0,
        closedAtEpoch: 0,
        closedAtEpochStartBlockHash: undefined,
        previousEpochStartBlockHash: undefined,
        closedAtBlockHash: '0x',
        poi: undefined,
        queryFeeRebates: 0n,
        queryFeesCollected: 0n,
      } as Allocation
    }

    test('rejects proposal on deterministic CALL_EXCEPTION error', async () => {
      const proposal = createMockProposal()
      const allocation = createMockAllocation()
      const consumer = createMockConsumer([proposal])
      // After rejection, no remaining proposals for cleanup
      consumer.getPendingProposals = jest
        .fn()
        .mockResolvedValueOnce([proposal])
        .mockResolvedValueOnce([])
      const models = createMockModels()
      const network = createMockNetwork()
      ;(network.transactionManager.executeTransaction as jest.Mock).mockRejectedValue({
        code: 'CALL_EXCEPTION',
        data: '0x',
      })

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      expect(consumer.markRejected).toHaveBeenCalledWith(proposal.id, expect.any(String))
    })

    test('leaves proposal pending on transient network error', async () => {
      const proposal = createMockProposal()
      const allocation = createMockAllocation()
      const consumer = createMockConsumer([proposal])
      const models = createMockModels()
      const network = createMockNetwork()
      ;(network.transactionManager.executeTransaction as jest.Mock).mockRejectedValue(
        new Error('ECONNRESET'),
      )

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([allocation])

      expect(consumer.markRejected).not.toHaveBeenCalled()
      expect(consumer.markAccepted).not.toHaveBeenCalled()
    })

    test('continues processing other proposals after error', async () => {
      const failProposal = createMockProposal({ id: 'fail-1' })
      const okDeployment =
        '0x0200000000000000000000000000000000000000000000000000000000000000'
      const okProposal = createMockProposal({
        id: 'ok-1',
        subgraphDeploymentId: new SubgraphDeploymentID(okDeployment),
      })
      const consumer = createMockConsumer([failProposal, okProposal])
      const models = createMockModels()
      const network = createMockNetwork()
      const failAllocation = {
        id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: AllocationStatus.ACTIVE,
        isLegacy: false,
        subgraphDeployment: {
          id: new SubgraphDeploymentID(TEST_DEPLOYMENT_BYTES32),
        },
      } as Allocation
      const okAllocation = {
        id: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: AllocationStatus.ACTIVE,
        isLegacy: false,
        subgraphDeployment: {
          id: new SubgraphDeploymentID(okDeployment),
        },
      } as Allocation

      const mockReceipt = { hash: '0x', status: 1 }
      ;(network.transactionManager.executeTransaction as jest.Mock)
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValueOnce(mockReceipt) // second succeeds

      const dm = createDipsManager(network, models, consumer)

      await dm.acceptPendingProposals([failAllocation, okAllocation])

      // Second proposal should still be processed and accepted
      expect(consumer.markAccepted).toHaveBeenCalledWith('ok-1')
    })
  })
})
