/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionInput, ActionStatus, ActionType, validateActionInputs } from '../actions'
import { AllocationStatus } from '../allocations'

const mockAllocation = {
  status: AllocationStatus.ACTIVE,
  subgraphDeployment: { id: { ipfsHash: 'QmTest' } },
}

const createMockNetworkMonitor = (hasAgreement: boolean) => ({
  hasActiveDipsAgreement: jest.fn().mockResolvedValue(hasAgreement),
  allocation: jest.fn().mockResolvedValue(mockAllocation),
  subgraphDeployment: jest.fn().mockResolvedValue({}),
})

const createMockLogger = () => ({
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
  trace: jest.fn(),
})

const baseAction: ActionInput = {
  type: ActionType.UNALLOCATE,
  deploymentID: 'QmTest',
  allocationID: '0x1234567890123456789012345678901234567890',
  source: 'test',
  reason: 'test',
  status: ActionStatus.QUEUED,
  priority: 0,
  protocolNetwork: 'eip155:421614',
  force: false,
  isLegacy: false,
}

describe('validateActionInputs DIPS agreement protection', () => {
  it('should reject UNALLOCATE with active DIPS agreement when force is not set', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    await expect(
      validateActionInputs([baseAction], monitor as any, logger as any),
    ).rejects.toThrow(/active DIPS agreement/)
  })

  it('should allow UNALLOCATE with active DIPS agreement when force is true', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    const action = { ...baseAction, force: true }

    await expect(
      validateActionInputs([action], monitor as any, logger as any),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      'Force-closing allocation with active DIPS agreement',
      expect.objectContaining({ allocationId: action.allocationID }),
    )
  })

  it('should allow UNALLOCATE with no active DIPS agreement', async () => {
    const monitor = createMockNetworkMonitor(false)
    const logger = createMockLogger()

    await expect(
      validateActionInputs([baseAction], monitor as any, logger as any),
    ).resolves.toBeUndefined()
  })

  it('should not check agreement for ALLOCATE actions', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    const action: ActionInput = {
      ...baseAction,
      type: ActionType.ALLOCATE,
      amount: '10000',
      allocationID: undefined,
    }

    await expect(
      validateActionInputs([action], monitor as any, logger as any),
    ).resolves.toBeUndefined()

    expect(monitor.hasActiveDipsAgreement).not.toHaveBeenCalled()
  })

  it('should not check DIPS agreement for REALLOCATE actions', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    const action: ActionInput = {
      ...baseAction,
      type: ActionType.REALLOCATE,
      amount: '10000',
    }

    // REALLOCATE still validates but doesn't check DIPS agreements
    // (REALLOCATE itself is deprecated and will be removed)
    await expect(
      validateActionInputs([action], monitor as any, logger as any),
    ).resolves.not.toThrow()
  })
})
