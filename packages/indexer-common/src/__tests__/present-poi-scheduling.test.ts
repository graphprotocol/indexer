/* eslint-disable @typescript-eslint/no-explicit-any */
import { Operator } from '../operator'
import { ActionType } from '../actions'
import { AllocationStatus, Allocation } from '../allocations'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

const deployment = new SubgraphDeploymentID(
  'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
)

function createAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: '0x0000000000000000000000000000000000000001',
    status: AllocationStatus.ACTIVE,
    isLegacy: false,
    subgraphDeployment: {
      id: deployment,
      ipfsHash: deployment.ipfsHash,
    },
    indexer: '0x0000000000000000000000000000000000000000',
    allocatedTokens: 10000000000000000000n, // 10 GRT
    createdAt: 0,
    createdAtEpoch: 1,
    ...overrides,

  } as any as Allocation
}

function createNetwork(
  isHorizon: boolean,
  maxPOIStaleness: bigint,
  lastPOIPresentedAt: bigint,
  createdAt: bigint = 0n,
) {
  return {
    isHorizon: { value: jest.fn().mockResolvedValue(isHorizon) },
    contracts: {
      SubgraphService: {
        maxPOIStaleness: jest.fn().mockResolvedValue(maxPOIStaleness),
        getAllocation: jest.fn().mockResolvedValue({
          lastPOIPresentedAt,
          createdAt,
        }),
      },
    },
    specification: { networkIdentifier: 'eip155:421614' },
  }
}

describe('presentPOIForActiveAllocations', () => {
  let operator: Operator
  let queueActionSpy: jest.SpyInstance

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockLogger: any = {
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    operator = Object.create(Operator.prototype)
    operator.logger = mockLogger

    operator.specification = {
      networkIdentifier: 'eip155:421614',
      indexerOptions: { allocationManagementMode: 'auto' },
    } as any
    queueActionSpy = jest.spyOn(operator, 'queueAction').mockResolvedValue([])
  })

  it('should queue PRESENT_POI for non-altruistic Horizon allocation approaching staleness', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const maxStaleness = 28800n // 8 hours
    const threshold = (maxStaleness * 3n) / 4n // 75% = 21600s
    // lastPresented is past the threshold
    const lastPresented = now - threshold - 100n

    const network = createNetwork(true, maxStaleness, lastPresented)
    const allocations = [createAllocation()]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ActionType.PRESENT_POI,
        params: expect.objectContaining({
          allocationID: allocations[0].id,
          deploymentID: deployment.ipfsHash,
        }),
        reason: 'presentPOI:staleness-prevention',
        protocolNetwork: 'eip155:421614',
        isLegacy: false,
      }),
      false,
    )
  })

  it('should not queue PRESENT_POI for altruistic allocations (0 tokens)', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const network = createNetwork(true, 28800n, now - 25000n)
    const allocations = [createAllocation({ allocatedTokens: 0n })]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).not.toHaveBeenCalled()
    expect(network.contracts.SubgraphService.getAllocation).not.toHaveBeenCalled()
  })

  it('should not queue PRESENT_POI when not yet approaching staleness', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    // Well within threshold
    const lastPresented = now - 1000n
    const network = createNetwork(true, 28800n, lastPresented)
    const allocations = [createAllocation()]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).not.toHaveBeenCalled()
  })

  it('should skip legacy allocations', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const network = createNetwork(true, 28800n, now - 25000n)
    const allocations = [createAllocation({ isLegacy: true })]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).not.toHaveBeenCalled()
    expect(network.contracts.SubgraphService.getAllocation).not.toHaveBeenCalled()
  })

  it('should skip entirely when not Horizon network', async () => {
    const network = createNetwork(false, 28800n, 0n)
    const allocations = [createAllocation()]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).not.toHaveBeenCalled()
    expect(network.contracts.SubgraphService.maxPOIStaleness).not.toHaveBeenCalled()
  })

  it('should use createdAt when lastPOIPresentedAt is 0', async () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const maxStaleness = 28800n
    const threshold = (maxStaleness * 3n) / 4n
    // createdAt is past threshold, lastPOIPresentedAt is 0
    const createdAt = now - threshold - 100n

    const network = createNetwork(true, maxStaleness, 0n, createdAt)
    const allocations = [createAllocation()]

    await operator.presentPOIForActiveAllocations(mockLogger, allocations, network)

    expect(queueActionSpy).toHaveBeenCalled()
  })
})
