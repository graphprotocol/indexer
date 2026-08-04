/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ActionInput,
  ActionStatus,
  ActionType,
  assertSafeToCloseAllocation,
  validateActionInputs,
} from '../actions'
import { AllocationStatus } from '../allocations'

const mockAllocation = {
  status: AllocationStatus.ACTIVE,
  subgraphDeployment: { id: { ipfsHash: 'QmTest' } },
}

const createMockNetworkMonitor = (hasAgreement: boolean) => ({
  hasCollectableDipsAgreement: jest.fn().mockResolvedValue(hasAgreement),
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
}

describe('validateActionInputs DIPS agreement protection', () => {
  it('should reject UNALLOCATE with a collectable DIPS agreement when force is not set', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    await expect(
      validateActionInputs([baseAction], monitor as any, logger as any),
    ).rejects.toThrow(/DIPS agreement that can still collect fees/)
  })

  it('should allow UNALLOCATE with a collectable DIPS agreement when force is true', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    const action = { ...baseAction, force: true }

    await expect(
      validateActionInputs([action], monitor as any, logger as any),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      'Force-closing allocation with a collectable DIPS agreement',
      expect.objectContaining({ allocationId: action.allocationID }),
    )
  })

  it('should allow UNALLOCATE with no collectable DIPS agreement', async () => {
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

    expect(monitor.hasCollectableDipsAgreement).not.toHaveBeenCalled()
  })
})

// The same guard is shared with the direct closeAllocation resolver, so it is
// also covered on its own, outside the action-validation wrapper.
describe('assertSafeToCloseAllocation', () => {
  const allocationID = baseAction.allocationID as string

  it('rejects an unforced close when the agreement can still collect', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    await expect(
      assertSafeToCloseAllocation(monitor as any, allocationID, false, logger as any),
    ).rejects.toThrow(/DIPS agreement that can still collect fees/)
  })

  it('allows a forced close but records a warning', async () => {
    const monitor = createMockNetworkMonitor(true)
    const logger = createMockLogger()

    await expect(
      assertSafeToCloseAllocation(monitor as any, allocationID, true, logger as any),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      'Force-closing allocation with a collectable DIPS agreement',
      expect.objectContaining({ allocationId: allocationID }),
    )
  })

  it('allows a close when nothing is collectable, forced or not', async () => {
    for (const force of [false, true]) {
      const monitor = createMockNetworkMonitor(false)
      const logger = createMockLogger()

      await expect(
        assertSafeToCloseAllocation(monitor as any, allocationID, force, logger as any),
      ).resolves.toBeUndefined()
      expect(logger.warn).not.toHaveBeenCalled()
    }
  })
})
