import { AllocationPriorityQueue } from '../allocation-priority-queue'
import { AllocationDecision } from '../../subgraphs'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

// Mock logger
const mockLogger = {
  child: jest.fn().mockReturnThis(),
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any

// Helper to create mock allocation decisions
function createMockDecision(
  ipfsHash: string,
  toAllocate: boolean,
  options: {
    decisionBasis?: 'always' | 'rules' | 'offchain' | 'never'
    allocationAmount?: string
    safety?: boolean
  } = {},
): AllocationDecision {
  return {
    deployment: new SubgraphDeploymentID(ipfsHash),
    toAllocate,
    protocolNetwork: 'arbitrum-one',
    reasonString: 'test',
    ruleMatch: {
      rule: {
        identifier: 'global',
        identifierType: 1,
        decisionBasis: options.decisionBasis || 'rules',
        allocationAmount: options.allocationAmount || '1000',
        safety: options.safety !== false,
      },
      protocolNetwork: 'arbitrum-one',
    },
  } as unknown as AllocationDecision
}

describe('AllocationPriorityQueue', () => {
  let queue: AllocationPriorityQueue

  beforeEach(() => {
    queue = new AllocationPriorityQueue(mockLogger)
  })

  afterEach(() => {
    queue.dispose()
  })

  describe('enqueue and dequeue', () => {
    it('should enqueue and dequeue items', () => {
      const decision = createMockDecision('QmTest1234567890123456789012345678901234567890', true)

      queue.enqueue(decision)
      expect(queue.size()).toBe(1)

      const dequeued = queue.dequeue()
      expect(dequeued).toBeDefined()
      expect(dequeued?.deployment.ipfsHash).toBe(decision.deployment.ipfsHash)
      expect(queue.size()).toBe(0)
    })

    it('should return undefined when dequeuing from empty queue', () => {
      const result = queue.dequeue()
      expect(result).toBeUndefined()
    })

    it('should prioritize allocations over deallocations', () => {
      const deallocate = createMockDecision(
        'QmDeal1234567890123456789012345678901234567890',
        false,
      )
      const allocate = createMockDecision(
        'QmAloc1234567890123456789012345678901234567890',
        true,
      )

      // Enqueue deallocate first
      queue.enqueue(deallocate)
      queue.enqueue(allocate)

      // Allocate should come out first (higher priority)
      const first = queue.dequeue()
      expect(first?.toAllocate).toBe(true)
    })

    it('should prioritize "always" decisions over "rules" decisions', () => {
      const rulesDecision = createMockDecision(
        'QmRule1234567890123456789012345678901234567890',
        true,
        { decisionBasis: 'rules' },
      )
      const alwaysDecision = createMockDecision(
        'QmAlwa1234567890123456789012345678901234567890',
        true,
        { decisionBasis: 'always' },
      )

      queue.enqueue(rulesDecision)
      queue.enqueue(alwaysDecision)

      const first = queue.dequeue()
      expect(first?.ruleMatch.rule?.decisionBasis).toBe('always')
    })

    it('should deprioritize unsafe deployments', () => {
      const safeDecision = createMockDecision(
        'QmSafe1234567890123456789012345678901234567890',
        true,
        { safety: true },
      )
      const unsafeDecision = createMockDecision(
        'QmUnsa1234567890123456789012345678901234567890',
        true,
        { safety: false },
      )

      queue.enqueue(unsafeDecision)
      queue.enqueue(safeDecision)

      const first = queue.dequeue()
      expect(first?.ruleMatch.rule?.safety).toBe(true)
    })
  })

  describe('batch operations', () => {
    it('should enqueue batch efficiently', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', true),
        createMockDecision('QmTest3234567890123456789012345678901234567890', false),
      ]

      queue.enqueueBatch(decisions)

      expect(queue.size()).toBe(3)
    })

    it('should dequeue batch in priority order', () => {
      const decisions = [
        createMockDecision('QmDeal1234567890123456789012345678901234567890', false),
        createMockDecision('QmAloc1234567890123456789012345678901234567890', true),
        createMockDecision('QmAlwa1234567890123456789012345678901234567890', true, {
          decisionBasis: 'always',
        }),
      ]

      queue.enqueueBatch(decisions)

      const batch = queue.dequeueBatch(2)
      expect(batch).toHaveLength(2)

      // Should get the two allocations first (both toAllocate=true)
      expect(batch.every((d) => d.toAllocate)).toBe(true)
    })

    it('should handle empty batch enqueue', () => {
      queue.enqueueBatch([])
      expect(queue.size()).toBe(0)
    })

    it('should handle dequeue batch larger than queue size', () => {
      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )
      queue.enqueue(decision)

      const batch = queue.dequeueBatch(10)
      expect(batch).toHaveLength(1)
    })
  })

  describe('peek', () => {
    it('should peek without removing', () => {
      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )
      queue.enqueue(decision)

      const peeked = queue.peek()
      expect(peeked?.deployment.ipfsHash).toBe(decision.deployment.ipfsHash)
      expect(queue.size()).toBe(1)
    })

    it('should return undefined on empty queue', () => {
      expect(queue.peek()).toBeUndefined()
    })

    it('should peek batch without removing', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', true),
      ]
      queue.enqueueBatch(decisions)

      const peeked = queue.peekBatch(1)
      expect(peeked).toHaveLength(1)
      expect(queue.size()).toBe(2)
    })
  })

  describe('filter and remove', () => {
    it('should filter items by predicate', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', false),
        createMockDecision('QmTest3234567890123456789012345678901234567890', true),
      ]
      queue.enqueueBatch(decisions)

      const allocations = queue.filter((d) => d.toAllocate)
      expect(allocations).toHaveLength(2)
    })

    it('should remove items by predicate', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', false),
        createMockDecision('QmTest3234567890123456789012345678901234567890', true),
      ]
      queue.enqueueBatch(decisions)

      const removed = queue.remove((d) => !d.toAllocate)
      expect(removed).toBe(1)
      expect(queue.size()).toBe(2)
    })
  })

  describe('reprioritize', () => {
    it('should reprioritize existing item', () => {
      const lowPriority = createMockDecision(
        'QmLow11234567890123456789012345678901234567890',
        false,
      )
      const highPriority = createMockDecision(
        'QmHigh1234567890123456789012345678901234567890',
        true,
      )

      queue.enqueue(highPriority)
      queue.enqueue(lowPriority)

      // Boost low priority item
      const success = queue.reprioritize(
        'QmLow11234567890123456789012345678901234567890',
        (current) => current + 1000,
      )

      expect(success).toBe(true)

      // Now low priority item should be first
      const first = queue.dequeue()
      expect(first?.deployment.ipfsHash).toBe('QmLow11234567890123456789012345678901234567890')
    })

    it('should return false for non-existent item', () => {
      const result = queue.reprioritize('nonexistent', (p) => p + 100)
      expect(result).toBe(false)
    })
  })

  describe('has', () => {
    it('should check if deployment exists in queue', () => {
      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )
      queue.enqueue(decision)

      expect(queue.has('QmTest1234567890123456789012345678901234567890')).toBe(true)
      expect(queue.has('nonexistent')).toBe(false)
    })
  })

  describe('metrics', () => {
    it('should track metrics', () => {
      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )

      queue.enqueue(decision)
      queue.dequeue()

      const metrics = queue.getMetrics()
      expect(metrics.totalEnqueued).toBe(1)
      expect(metrics.totalDequeued).toBe(1)
      expect(metrics.currentSize).toBe(0)
    })

    it('should track peak size', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', true),
        createMockDecision('QmTest3234567890123456789012345678901234567890', true),
      ]

      queue.enqueueBatch(decisions)
      queue.dequeue()
      queue.dequeue()

      const metrics = queue.getMetrics()
      expect(metrics.peakSize).toBe(3)
      expect(metrics.currentSize).toBe(1)
    })
  })

  describe('getItems', () => {
    it('should return items with priorities and wait times', async () => {
      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )
      queue.enqueue(decision)

      await new Promise((resolve) => setTimeout(resolve, 10))

      const items = queue.getItems()
      expect(items).toHaveLength(1)
      expect(items[0].priority).toBeGreaterThan(0)
      expect(items[0].waitTime).toBeGreaterThanOrEqual(10)
    })
  })

  describe('clear', () => {
    it('should clear all items', () => {
      const decisions = [
        createMockDecision('QmTest1234567890123456789012345678901234567890', true),
        createMockDecision('QmTest2234567890123456789012345678901234567890', true),
      ]
      queue.enqueueBatch(decisions)

      queue.clear()

      expect(queue.size()).toBe(0)
      expect(queue.isEmpty()).toBe(true)
    })
  })

  describe('disposal', () => {
    it('should throw when operating on disposed queue', () => {
      queue.dispose()

      const decision = createMockDecision(
        'QmTest1234567890123456789012345678901234567890',
        true,
      )

      expect(() => queue.enqueue(decision)).toThrow('disposed')
      expect(() => queue.dequeue()).toThrow('disposed')
    })

    it('should be idempotent', () => {
      queue.dispose()
      queue.dispose() // Should not throw
    })
  })
})
