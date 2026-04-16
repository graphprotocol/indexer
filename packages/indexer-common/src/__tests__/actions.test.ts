import { ActionInput, ActionStatus, ActionType, isValidActionInput } from '../actions'

describe('Action Validation', () => {
  describe('isValidActionInput', () => {
    const baseAction: Partial<ActionInput> = {
      status: ActionStatus.QUEUED,
      source: 'indexerAgent',
      reason: 'test',
      priority: 0,
      protocolNetwork: 'eip155:421614',
    }

    test('validates ALLOCATE action requires deploymentID and amount', () => {
      const validAllocate: ActionInput = {
        ...baseAction,
        type: ActionType.ALLOCATE,
        deploymentID: 'Qmtest',
        amount: '10000',
      } as ActionInput

      expect(isValidActionInput(validAllocate)).toBe(true)

      const missingAmount: ActionInput = {
        ...baseAction,
        type: ActionType.ALLOCATE,
        deploymentID: 'Qmtest',
      } as ActionInput

      expect(isValidActionInput(missingAmount)).toBe(false)
    })

    test('validates UNALLOCATE action requires deploymentID and allocationID', () => {
      const validUnallocate: ActionInput = {
        ...baseAction,
        type: ActionType.UNALLOCATE,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
      } as ActionInput

      expect(isValidActionInput(validUnallocate)).toBe(true)

      const missingAllocationID: ActionInput = {
        ...baseAction,
        type: ActionType.UNALLOCATE,
        deploymentID: 'Qmtest',
      } as ActionInput

      expect(isValidActionInput(missingAllocationID)).toBe(false)
    })

    test('validates REALLOCATE action requires deploymentID, allocationID, and amount', () => {
      const validReallocate: ActionInput = {
        ...baseAction,
        type: ActionType.REALLOCATE,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
        amount: '20000',
      } as ActionInput

      expect(isValidActionInput(validReallocate)).toBe(true)

      const missingAmount: ActionInput = {
        ...baseAction,
        type: ActionType.REALLOCATE,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
      } as ActionInput

      expect(isValidActionInput(missingAmount)).toBe(false)
    })

    test('validates RESIZE action requires deploymentID, allocationID, and amount', () => {
      const validResize: ActionInput = {
        ...baseAction,
        type: ActionType.RESIZE,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
        amount: '20000',
      } as ActionInput

      expect(isValidActionInput(validResize)).toBe(true)

      // Missing amount
      const missingAmount: ActionInput = {
        ...baseAction,
        type: ActionType.RESIZE,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
      } as ActionInput

      expect(isValidActionInput(missingAmount)).toBe(false)

      // Missing allocationID
      const missingAllocationID: ActionInput = {
        ...baseAction,
        type: ActionType.RESIZE,
        deploymentID: 'Qmtest',
        amount: '20000',
      } as ActionInput

      expect(isValidActionInput(missingAllocationID)).toBe(false)

      // Missing deploymentID
      const missingDeploymentID: ActionInput = {
        ...baseAction,
        type: ActionType.RESIZE,
        allocationID: '0x1234567890123456789012345678901234567890',
        amount: '20000',
      } as ActionInput

      expect(isValidActionInput(missingDeploymentID)).toBe(false)
    })

    test('validates PRESENT_POI action', () => {
      const validPresentPOI: ActionInput = {
        ...baseAction,
        type: ActionType.PRESENT_POI,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
      } as ActionInput

      expect(isValidActionInput(validPresentPOI)).toBe(true)

      // Missing allocationID
      const missingAllocationID: ActionInput = {
        ...baseAction,
        type: ActionType.PRESENT_POI,
        deploymentID: 'Qmtest',
      } as ActionInput

      expect(isValidActionInput(missingAllocationID)).toBe(false)

      // Missing deploymentID
      const missingDeploymentID: ActionInput = {
        ...baseAction,
        type: ActionType.PRESENT_POI,
        allocationID: '0x1234567890123456789012345678901234567890',
      } as ActionInput

      expect(isValidActionInput(missingDeploymentID)).toBe(false)

      // With POI provided (publicPOI and poiBlockNumber are optional)
      const withPoiButMissingPublicPOI = {
        ...baseAction,
        type: ActionType.PRESENT_POI,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
        poi: '0x' + 'ab'.repeat(32),
        isLegacy: false,
      }

      expect(isValidActionInput(withPoiButMissingPublicPOI)).toBe(true)

      // With all POI fields provided
      const withAllPoiFields = {
        ...baseAction,
        type: ActionType.PRESENT_POI,
        deploymentID: 'Qmtest',
        allocationID: '0x1234567890123456789012345678901234567890',
        poi: '0x' + 'ab'.repeat(32),
        publicPOI: '0x' + 'cd'.repeat(32),
        poiBlockNumber: 12345,
        isLegacy: false,
      }

      expect(isValidActionInput(withAllPoiFields)).toBe(true)
    })

    test('validates common required fields (source, reason, status, priority)', () => {
      // Missing status
      const missingStatus = {
        type: ActionType.ALLOCATE,
        deploymentID: 'Qmtest',
        amount: '10000',
        source: 'test',
        reason: 'test',
        priority: 0,
        protocolNetwork: 'eip155:421614',
      }

      expect(isValidActionInput(missingStatus)).toBe(false)

      // Missing source
      const missingSource = {
        type: ActionType.ALLOCATE,
        status: ActionStatus.QUEUED,
        deploymentID: 'Qmtest',
        amount: '10000',
        reason: 'test',
        priority: 0,
        protocolNetwork: 'eip155:421614',
      }

      expect(isValidActionInput(missingSource)).toBe(false)

      // Missing priority
      const missingPriority = {
        type: ActionType.ALLOCATE,
        status: ActionStatus.QUEUED,
        deploymentID: 'Qmtest',
        amount: '10000',
        source: 'test',
        reason: 'test',
        protocolNetwork: 'eip155:421614',
      }

      expect(isValidActionInput(missingPriority)).toBe(false)
    })

    test('rejects action without type field', () => {
      const noType = {
        status: ActionStatus.QUEUED,
        deploymentID: 'Qmtest',
        amount: '10000',
        source: 'test',
        reason: 'test',
        priority: 0,
        protocolNetwork: 'eip155:421614',
      }

      expect(isValidActionInput(noType)).toBe(false)
    })
  })
})
