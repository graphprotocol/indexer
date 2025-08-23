import { Logger } from '@graphprotocol/common-ts'
import { AllocationDecision } from '../subgraphs'
import { BigNumber } from 'ethers'

export interface PriorityItem<T> {
  item: T
  priority: number
}

export interface QueueMetrics {
  totalEnqueued: number
  totalDequeued: number
  currentSize: number
  averageWaitTime: number
}

/**
 * Priority queue for allocation decisions with intelligent prioritization
 */
export class AllocationPriorityQueue {
  private queue: PriorityItem<AllocationDecision>[] = []
  private processingTimes = new Map<string, number>()
  private metrics: QueueMetrics = {
    totalEnqueued: 0,
    totalDequeued: 0,
    currentSize: 0,
    averageWaitTime: 0,
  }
  private logger: Logger
  private signalThreshold: BigNumber
  private stakeThreshold: BigNumber

  constructor(
    logger: Logger,
    signalThreshold: BigNumber = BigNumber.from('1000000000000000000000'), // 1000 GRT
    stakeThreshold: BigNumber = BigNumber.from('10000000000000000000000'), // 10000 GRT
  ) {
    this.logger = logger.child({ component: 'AllocationPriorityQueue' })
    this.signalThreshold = signalThreshold
    this.stakeThreshold = stakeThreshold
  }

  /**
   * Enqueue an allocation decision with calculated priority
   */
  enqueue(decision: AllocationDecision): void {
    const priority = this.calculatePriority(decision)
    const item: PriorityItem<AllocationDecision> = { item: decision, priority }
    
    // Binary search to find insertion point for O(log n) insertion
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

    this.queue.splice(left, 0, item)
    this.processingTimes.set(decision.deployment.ipfsHash, Date.now())
    
    this.metrics.totalEnqueued++
    this.metrics.currentSize = this.queue.length
    
    this.logger.trace('Enqueued allocation decision', {
      deployment: decision.deployment.ipfsHash,
      priority,
      queueSize: this.queue.length,
    })
  }

  /**
   * Enqueue multiple decisions efficiently
   */
  enqueueBatch(decisions: AllocationDecision[]): void {
    const itemsWithPriority = decisions.map(decision => ({
      item: decision,
      priority: this.calculatePriority(decision),
    }))

    // Sort new items by priority
    itemsWithPriority.sort((a, b) => b.priority - a.priority)

    // Merge with existing queue
    const merged: PriorityItem<AllocationDecision>[] = []
    let i = 0, j = 0

    while (i < this.queue.length && j < itemsWithPriority.length) {
      if (this.queue[i].priority >= itemsWithPriority[j].priority) {
        merged.push(this.queue[i++])
      } else {
        merged.push(itemsWithPriority[j++])
      }
    }

    // Add remaining items
    while (i < this.queue.length) merged.push(this.queue[i++])
    while (j < itemsWithPriority.length) merged.push(itemsWithPriority[j++])

    this.queue = merged

    // Update metrics
    decisions.forEach(decision => {
      this.processingTimes.set(decision.deployment.ipfsHash, Date.now())
    })
    
    this.metrics.totalEnqueued += decisions.length
    this.metrics.currentSize = this.queue.length

    this.logger.debug('Batch enqueued allocation decisions', {
      count: decisions.length,
      queueSize: this.queue.length,
    })
  }

  /**
   * Dequeue the highest priority allocation decision
   */
  dequeue(): AllocationDecision | undefined {
    const item = this.queue.shift()
    if (!item) return undefined

    const decision = item.item
    const enqueueTime = this.processingTimes.get(decision.deployment.ipfsHash)
    
    if (enqueueTime) {
      const waitTime = Date.now() - enqueueTime
      this.updateAverageWaitTime(waitTime)
      this.processingTimes.delete(decision.deployment.ipfsHash)
    }

    this.metrics.totalDequeued++
    this.metrics.currentSize = this.queue.length

    this.logger.trace('Dequeued allocation decision', {
      deployment: decision.deployment.ipfsHash,
      priority: item.priority,
      queueSize: this.queue.length,
    })

    return decision
  }

  /**
   * Dequeue multiple items at once for batch processing
   */
  dequeueBatch(count: number): AllocationDecision[] {
    const items: AllocationDecision[] = []
    
    for (let i = 0; i < count && this.queue.length > 0; i++) {
      const decision = this.dequeue()
      if (decision) items.push(decision)
    }

    return items
  }

  /**
   * Peek at the highest priority item without removing it
   */
  peek(): AllocationDecision | undefined {
    return this.queue[0]?.item
  }

  /**
   * Get all items matching a predicate
   */
  filter(predicate: (decision: AllocationDecision) => boolean): AllocationDecision[] {
    return this.queue
      .filter(item => predicate(item.item))
      .map(item => item.item)
  }

  /**
   * Remove items matching a predicate
   */
  remove(predicate: (decision: AllocationDecision) => boolean): number {
    const initialSize = this.queue.length
    this.queue = this.queue.filter(item => !predicate(item.item))
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
    const index = this.queue.findIndex(
      item => item.item.deployment.ipfsHash === deployment
    )
    
    if (index === -1) return false

    const item = this.queue[index]
    const newPriority = priorityModifier(item.priority)
    
    if (newPriority === item.priority) return true

    // Remove and re-insert with new priority
    this.queue.splice(index, 1)
    item.priority = newPriority
    
    let left = 0
    let right = this.queue.length
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.queue[mid].priority > newPriority) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    
    this.queue.splice(left, 0, item)
    
    this.logger.trace('Reprioritized allocation', {
      deployment,
      oldPriority: item.priority,
      newPriority,
    })
    
    return true
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
   * Get queue items sorted by priority
   */
  getItems(): Array<{ decision: AllocationDecision; priority: number }> {
    return this.queue.map(item => ({
      decision: item.item,
      priority: item.priority,
    }))
  }

  /**
   * Calculate priority for an allocation decision
   * Higher number = higher priority
   */
  private calculatePriority(decision: AllocationDecision): number {
    let priority = 0

    // High priority factors (100-999 points)
    if (decision.toAllocate) {
      priority += 500 // Creating allocations is generally high priority
    }

    // Lower priority for closing allocations (-100 points)
    if (!decision.toAllocate) {
      priority -= 100
    }

    // Rule-based priority
    if (decision.ruleMatch.rule) {
      const rule = decision.ruleMatch.rule
      
      // Higher allocation amount suggests higher importance
      if (rule.allocationAmount) {
        const amount = parseFloat(rule.allocationAmount)
        priority += Math.min(200, Math.log10(amount + 1) * 20)
      }
      
      // Priority based on decision basis
      if (rule.decisionBasis === 'always') {
        priority += 100
      } else if (rule.decisionBasis === 'rules') {
        priority += 50
      }
      
      // Safety considerations
      if (rule.safety === false) {
        priority -= 200 // Deprioritize unsafe deployments
      }
    }

    // Deployment ID based priority (for consistent ordering)
    const deploymentHash = decision.deployment.ipfsHash
    const hashPriority = parseInt(deploymentHash.slice(-4), 16) / 65535 * 10
    priority += hashPriority

    return Math.max(0, priority) // Ensure non-negative priority
  }

  /**
   * Update average wait time metric
   */
  private updateAverageWaitTime(waitTime: number): void {
    const alpha = 0.1 // Exponential moving average factor
    this.metrics.averageWaitTime = 
      alpha * waitTime + (1 - alpha) * this.metrics.averageWaitTime
  }
}