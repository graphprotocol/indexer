import { Logger } from '@graphprotocol/common-ts'
import { AllocationDecision } from '../subgraphs'
import { BigNumber } from 'ethers'

export interface PriorityItem<T> {
  item: T
  priority: number
  enqueuedAt: number
}

export interface QueueMetrics {
  totalEnqueued: number
  totalDequeued: number
  currentSize: number
  averageWaitTime: number
  peakSize: number
}

// Default configuration constants
const PRIORITY_QUEUE_DEFAULTS = {
  SIGNAL_THRESHOLD: '1000000000000000000000', // 1000 GRT
  STAKE_THRESHOLD: '10000000000000000000000', // 10000 GRT
  MAX_PROCESSING_TIMES_SIZE: 10000, // Maximum entries in processingTimes map
  CLEANUP_INTERVAL: 300_000, // 5 minutes
  MAX_STALE_AGE: 600_000, // 10 minutes - remove stale processing times
} as const

// Priority weight constants
const PRIORITY_WEIGHTS = {
  ALLOCATE: 500,
  DEALLOCATE: -100,
  ALWAYS_RULE: 100,
  RULES_RULE: 50,
  UNSAFE_PENALTY: -200,
  ALLOCATION_AMOUNT_MULTIPLIER: 20,
  ALLOCATION_AMOUNT_CAP: 200,
  HASH_PRIORITY_DIVISOR: 65535,
  HASH_PRIORITY_MULTIPLIER: 10,
} as const

/**
 * Priority queue for allocation decisions with intelligent prioritization.
 *
 * Features:
 * - O(log n) insertion with binary search
 * - O(n) batch merge sort for bulk operations
 * - Bounded memory with automatic cleanup
 * - Priority-based dequeuing
 * - Metrics tracking
 */
export class AllocationPriorityQueue {
  private queue: PriorityItem<AllocationDecision>[] = []
  private processingTimes = new Map<string, number>()
  private metrics: QueueMetrics = {
    totalEnqueued: 0,
    totalDequeued: 0,
    currentSize: 0,
    averageWaitTime: 0,
    peakSize: 0,
  }
  private logger: Logger
  private signalThreshold: BigNumber
  private stakeThreshold: BigNumber
  private cleanupInterval?: NodeJS.Timeout
  private disposed = false

  constructor(
    logger: Logger,
    signalThreshold: BigNumber = BigNumber.from(PRIORITY_QUEUE_DEFAULTS.SIGNAL_THRESHOLD),
    stakeThreshold: BigNumber = BigNumber.from(PRIORITY_QUEUE_DEFAULTS.STAKE_THRESHOLD),
  ) {
    this.logger = logger.child({ component: 'AllocationPriorityQueue' })
    this.signalThreshold = signalThreshold
    this.stakeThreshold = stakeThreshold

    // Start periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(
      () => this.cleanupStaleEntries(),
      PRIORITY_QUEUE_DEFAULTS.CLEANUP_INTERVAL,
    )

    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }

    this.logger.debug('AllocationPriorityQueue initialized', {
      signalThreshold: signalThreshold.toString(),
      stakeThreshold: stakeThreshold.toString(),
    })
  }

  /**
   * Enqueue an allocation decision with calculated priority
   */
  enqueue(decision: AllocationDecision): void {
    this.ensureNotDisposed()

    const priority = this.calculatePriority(decision)
    const now = Date.now()
    const item: PriorityItem<AllocationDecision> = {
      item: decision,
      priority,
      enqueuedAt: now,
    }

    // Binary search to find insertion point for O(log n) insertion
    const insertIndex = this.findInsertionIndex(priority)
    this.queue.splice(insertIndex, 0, item)

    // Track processing time with bounded map
    this.trackProcessingTime(decision.deployment.ipfsHash, now)

    this.metrics.totalEnqueued++
    this.updateSizeMetrics()

    this.logger.trace('Enqueued allocation decision', {
      deployment: decision.deployment.ipfsHash,
      priority,
      queueSize: this.queue.length,
    })
  }

  /**
   * Enqueue multiple decisions efficiently using merge sort
   */
  enqueueBatch(decisions: AllocationDecision[]): void {
    this.ensureNotDisposed()

    if (decisions.length === 0) return

    const now = Date.now()

    // Calculate priorities and create items
    const itemsWithPriority: PriorityItem<AllocationDecision>[] = decisions.map(
      (decision) => ({
        item: decision,
        priority: this.calculatePriority(decision),
        enqueuedAt: now,
      }),
    )

    // Sort new items by priority (descending)
    itemsWithPriority.sort((a, b) => b.priority - a.priority)

    // Merge with existing queue (both are sorted)
    this.queue = this.mergeSortedArrays(this.queue, itemsWithPriority)

    // Track processing times with bounds
    for (const decision of decisions) {
      this.trackProcessingTime(decision.deployment.ipfsHash, now)
    }

    this.metrics.totalEnqueued += decisions.length
    this.updateSizeMetrics()

    this.logger.debug('Batch enqueued allocation decisions', {
      count: decisions.length,
      queueSize: this.queue.length,
    })
  }

  /**
   * Dequeue the highest priority allocation decision
   */
  dequeue(): AllocationDecision | undefined {
    this.ensureNotDisposed()

    const item = this.queue.shift()
    if (!item) return undefined

    const decision = item.item
    const deploymentId = decision.deployment.ipfsHash

    // Calculate and track wait time
    const enqueueTime = this.processingTimes.get(deploymentId)
    if (enqueueTime) {
      const waitTime = Date.now() - enqueueTime
      this.updateAverageWaitTime(waitTime)
      this.processingTimes.delete(deploymentId)
    }

    this.metrics.totalDequeued++
    this.metrics.currentSize = this.queue.length

    this.logger.trace('Dequeued allocation decision', {
      deployment: deploymentId,
      priority: item.priority,
      queueSize: this.queue.length,
    })

    return decision
  }

  /**
   * Dequeue multiple items at once for batch processing
   */
  dequeueBatch(count: number): AllocationDecision[] {
    this.ensureNotDisposed()

    const actualCount = Math.min(count, this.queue.length)
    if (actualCount === 0) return []

    const items = this.queue.splice(0, actualCount)
    const decisions: AllocationDecision[] = []
    const now = Date.now()

    for (const item of items) {
      const deploymentId = item.item.deployment.ipfsHash
      const enqueueTime = this.processingTimes.get(deploymentId)

      if (enqueueTime) {
        const waitTime = now - enqueueTime
        this.updateAverageWaitTime(waitTime)
        this.processingTimes.delete(deploymentId)
      }

      decisions.push(item.item)
    }

    this.metrics.totalDequeued += decisions.length
    this.metrics.currentSize = this.queue.length

    this.logger.trace('Batch dequeued allocation decisions', {
      count: decisions.length,
      queueSize: this.queue.length,
    })

    return decisions
  }

  /**
   * Peek at the highest priority item without removing it
   */
  peek(): AllocationDecision | undefined {
    return this.queue[0]?.item
  }

  /**
   * Peek at multiple items without removing them
   */
  peekBatch(count: number): AllocationDecision[] {
    const actualCount = Math.min(count, this.queue.length)
    return this.queue.slice(0, actualCount).map((item) => item.item)
  }

  /**
   * Get all items matching a predicate
   */
  filter(predicate: (decision: AllocationDecision) => boolean): AllocationDecision[] {
    return this.queue.filter((item) => predicate(item.item)).map((item) => item.item)
  }

  /**
   * Remove items matching a predicate
   */
  remove(predicate: (decision: AllocationDecision) => boolean): number {
    const initialSize = this.queue.length
    const removedItems: PriorityItem<AllocationDecision>[] = []

    this.queue = this.queue.filter((item) => {
      if (predicate(item.item)) {
        removedItems.push(item)
        return false
      }
      return true
    })

    // Clean up processing times for removed items
    for (const item of removedItems) {
      this.processingTimes.delete(item.item.deployment.ipfsHash)
    }

    const removed = initialSize - this.queue.length

    if (removed > 0) {
      this.metrics.currentSize = this.queue.length
      this.logger.debug('Removed items from queue', { count: removed })
    }

    return removed
  }

  /**
   * Re-prioritize an existing item
   */
  reprioritize(
    deployment: string,
    priorityModifier: (current: number) => number,
  ): boolean {
    this.ensureNotDisposed()

    const index = this.queue.findIndex(
      (item) => item.item.deployment.ipfsHash === deployment,
    )

    if (index === -1) return false

    const item = this.queue[index]
    const newPriority = priorityModifier(item.priority)

    if (newPriority === item.priority) return true

    // Remove from current position
    this.queue.splice(index, 1)

    // Update priority and re-insert
    item.priority = newPriority
    const newIndex = this.findInsertionIndex(newPriority)
    this.queue.splice(newIndex, 0, item)

    this.logger.trace('Reprioritized allocation', {
      deployment,
      oldPriority: item.priority,
      newPriority,
    })

    return true
  }

  /**
   * Check if queue contains a deployment
   */
  has(deployment: string): boolean {
    return this.queue.some((item) => item.item.deployment.ipfsHash === deployment)
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = []
    this.processingTimes.clear()
    this.metrics.currentSize = 0
    this.logger.info('Queue cleared')
  }

  /**
   * Get queue metrics
   */
  getMetrics(): Readonly<QueueMetrics> {
    return { ...this.metrics }
  }

  /**
   * Get queue items sorted by priority (for debugging/monitoring)
   */
  getItems(): Array<{ decision: AllocationDecision; priority: number; waitTime: number }> {
    const now = Date.now()
    return this.queue.map((item) => ({
      decision: item.item,
      priority: item.priority,
      waitTime: now - item.enqueuedAt,
    }))
  }

  /**
   * Calculate priority for an allocation decision
   * Higher number = higher priority
   */
  private calculatePriority(decision: AllocationDecision): number {
    let priority = 0

    // High priority for creating allocations
    if (decision.toAllocate) {
      priority += PRIORITY_WEIGHTS.ALLOCATE
    } else {
      priority += PRIORITY_WEIGHTS.DEALLOCATE
    }

    // Rule-based priority
    if (decision.ruleMatch.rule) {
      const rule = decision.ruleMatch.rule

      // Higher allocation amount suggests higher importance
      if (rule.allocationAmount) {
        try {
          const amount = parseFloat(rule.allocationAmount)
          if (!isNaN(amount) && amount > 0) {
            priority += Math.min(
              PRIORITY_WEIGHTS.ALLOCATION_AMOUNT_CAP,
              Math.log10(amount + 1) * PRIORITY_WEIGHTS.ALLOCATION_AMOUNT_MULTIPLIER,
            )
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Priority based on decision basis
      if (rule.decisionBasis === 'always') {
        priority += PRIORITY_WEIGHTS.ALWAYS_RULE
      } else if (rule.decisionBasis === 'rules') {
        priority += PRIORITY_WEIGHTS.RULES_RULE
      }

      // Safety considerations
      if (rule.safety === false) {
        priority += PRIORITY_WEIGHTS.UNSAFE_PENALTY
      }
    }

    // Deployment ID based priority (for consistent ordering of equal priorities)
    const deploymentHash = decision.deployment.ipfsHash
    if (deploymentHash && deploymentHash.length >= 4) {
      const hashSuffix = deploymentHash.slice(-4)
      const hashValue = parseInt(hashSuffix, 16)
      if (!isNaN(hashValue)) {
        const hashPriority =
          (hashValue / PRIORITY_WEIGHTS.HASH_PRIORITY_DIVISOR) *
          PRIORITY_WEIGHTS.HASH_PRIORITY_MULTIPLIER
        priority += hashPriority
      }
    }

    return Math.max(0, priority)
  }

  /**
   * Find insertion index using binary search (descending order)
   */
  private findInsertionIndex(priority: number): number {
    let left = 0
    let right = this.queue.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.queue[mid].priority > priority) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }

  /**
   * Merge two sorted arrays (both in descending priority order)
   */
  private mergeSortedArrays(
    arr1: PriorityItem<AllocationDecision>[],
    arr2: PriorityItem<AllocationDecision>[],
  ): PriorityItem<AllocationDecision>[] {
    const merged: PriorityItem<AllocationDecision>[] = []
    let i = 0
    let j = 0

    while (i < arr1.length && j < arr2.length) {
      if (arr1[i].priority >= arr2[j].priority) {
        merged.push(arr1[i++])
      } else {
        merged.push(arr2[j++])
      }
    }

    // Add remaining items
    while (i < arr1.length) merged.push(arr1[i++])
    while (j < arr2.length) merged.push(arr2[j++])

    return merged
  }

  /**
   * Track processing time with bounded map size
   */
  private trackProcessingTime(deploymentId: string, timestamp: number): void {
    // If map is at capacity, remove oldest entries
    if (this.processingTimes.size >= PRIORITY_QUEUE_DEFAULTS.MAX_PROCESSING_TIMES_SIZE) {
      const entriesToRemove = Math.floor(
        PRIORITY_QUEUE_DEFAULTS.MAX_PROCESSING_TIMES_SIZE * 0.1,
      )
      const iterator = this.processingTimes.keys()

      for (let i = 0; i < entriesToRemove; i++) {
        const key = iterator.next().value
        if (key) {
          this.processingTimes.delete(key)
        }
      }

      this.logger.trace('Cleaned up processing times map', {
        removed: entriesToRemove,
        currentSize: this.processingTimes.size,
      })
    }

    this.processingTimes.set(deploymentId, timestamp)
  }

  /**
   * Clean up stale entries from processingTimes map
   */
  private cleanupStaleEntries(): void {
    if (this.disposed) return

    const now = Date.now()
    const maxAge = PRIORITY_QUEUE_DEFAULTS.MAX_STALE_AGE
    let cleaned = 0

    for (const [key, timestamp] of this.processingTimes.entries()) {
      if (now - timestamp > maxAge) {
        this.processingTimes.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.logger.trace('Cleaned up stale processing times', { count: cleaned })
    }
  }

  /**
   * Update average wait time metric using exponential moving average
   */
  private updateAverageWaitTime(waitTime: number): void {
    const alpha = 0.1
    this.metrics.averageWaitTime =
      alpha * waitTime + (1 - alpha) * this.metrics.averageWaitTime
  }

  /**
   * Update size-related metrics
   */
  private updateSizeMetrics(): void {
    this.metrics.currentSize = this.queue.length
    if (this.queue.length > this.metrics.peakSize) {
      this.metrics.peakSize = this.queue.length
    }
  }

  /**
   * Ensure queue is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('AllocationPriorityQueue has been disposed')
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.disposed) return

    this.disposed = true

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }

    this.clear()
    this.logger.debug('AllocationPriorityQueue disposed')
  }

  /**
   * Support for async disposal
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose()
  }
}
