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

const network = {
  specification: { networkIdentifier: 'eip155:421614' },
}

describe('presentPOIForAllocations', () => {
  let operator: Operator
  let queueActionSpy: jest.SpyInstance

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

  it('should queue PRESENT_POI for each allocation passed in', async () => {
    const alloc1 = createAllocation({
      id: '0x0000000000000000000000000000000000000001',
    })
    const alloc2 = createAllocation({
      id: '0x0000000000000000000000000000000000000002',
    })

    await operator.presentPOIForAllocations(mockLogger, [alloc1, alloc2], network)

    expect(queueActionSpy).toHaveBeenCalledTimes(2)
    expect(queueActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ActionType.PRESENT_POI,
        params: expect.objectContaining({
          allocationID: alloc1.id,
          deploymentID: deployment.ipfsHash,
        }),
        reason: 'presentPOI:staleness-prevention',
        protocolNetwork: 'eip155:421614',
        isLegacy: false,
      }),
      false,
    )
    expect(queueActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          allocationID: alloc2.id,
        }),
      }),
      false,
    )
  })

  it('should not queue anything when no allocations are passed', async () => {
    await operator.presentPOIForAllocations(mockLogger, [], network)
    expect(queueActionSpy).not.toHaveBeenCalled()
  })
})
