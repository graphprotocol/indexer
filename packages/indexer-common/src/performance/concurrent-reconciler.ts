import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Allocation } from '../allocations'
import { AllocationDecision } from '../subgraphs'
import { Network } from '../network'
import { Operator } from '../operator'
import pMap from 'p-map'
import PQueue from 'p-queue'
import { NetworkDataCache } from './network-cache'
import { CircuitBreaker } from './circuit-breaker'
import { AllocationPriorityQueue } from './allocation-priority-queue'

export interface ReconcilerOptions {
  concurrency?: number
  batchSize?: number
  retryAttempts?: number
  retryDelay?: number
  retryBackoffMultiplier?: number
  enableCircuitBreaker?: boolean
  enablePriorityQueue?: boolean
  enableCache?: boolean
  cacheTtl?: number
  cacheMaxSize?: number
}

export interface ReconciliationResult {
  deployment: string
  success: boolean
  error?: Error
  duration: number
  retries: number
}

export interface ReconciliationMetrics {
  totalProcessed: number
  successful: number
  failed: number
  averageProcessingTime: number
  queueDepth: number
  inProgress: number
}

// Default configuration constants
const RECONCILER_DEFAULTS = {
  CONCURRENCY: 20,
  BATCH_SIZE: 10,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
  CACHE_TTL: 30_000,
  CACHE_MAX_SIZE: 1000,
} as const

/**
 * Concurrent reconciler for high-throughput allocation processing.
 *
 * Features:
 * - Parallel processing with configurable concurrency
 * - Priority-based task ordering
 * - Circuit breaker for failure handling
 * - Caching for deduplication
 * - Retry with exponential backoff
 * - Comprehensive metrics
 */
export class ConcurrentReconciler {
  private readonly logger: Logger
  private readonly queue: PQueue
  private readonly priorityQueue?: AllocationPriorityQueue
  private readonly cache?: NetworkDataCache
  private readonly circuitBreaker?: CircuitBreaker
  private readonly workers = new Map<string, Promise<ReconciliationResult>>()
  private metrics: ReconciliationMetrics = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    averageProcessingTime: 0,
    queueDepth: 0,
    inProgress: 0,
  }
  private readonly options: Required<ReconcilerOptions>
  private disposed = false

  constructor(logger: Logger, options: ReconcilerOptions = {}) {
    this.logger = logger.child({ component: 'ConcurrentReconciler' })

    this.options = {
      concurrency: options.concurrency ?? RECONCILER_DEFAULTS.CONCURRENCY,
      batchSize: options.batchSize ?? RECONCILER_DEFAULTS.BATCH_SIZE,
      retryAttempts: options.retryAttempts ?? RECONCILER_DEFAULTS.RETRY_ATTEMPTS,
      retryDelay: options.retryDelay ?? RECONCILER_DEFAULTS.RETRY_DELAY,
      retryBackoffMultiplier:
        options.retryBackoffMultiplier ?? RECONCILER_DEFAULTS.RETRY_BACKOFF_MULTIPLIER,
      enableCircuitBreaker: options.enableCircuitBreaker !== false,
      enablePriorityQueue: options.enablePriorityQueue !== false,
      enableCache: options.enableCache !== false,
      cacheTtl: options.cacheTtl ?? RECONCILER_DEFAULTS.CACHE_TTL,
      cacheMaxSize: options.cacheMaxSize ?? RECONCILER_DEFAULTS.CACHE_MAX_SIZE,
    }

    // Initialize queue with concurrency control
    this.queue = new PQueue({ concurrency: this.options.concurrency })

    // Initialize optional components
    if (this.options.enablePriorityQueue) {
      this.priorityQueue = new AllocationPriorityQueue(this.logger)
    }

    if (this.options.enableCache) {
      this.cache = new NetworkDataCache(this.logger, {
        ttl: this.options.cacheTtl,
        maxSize: this.options.cacheMaxSize,
        enableMetrics: true,
      })
    }

    if (this.options.enableCircuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(this.logger, {
        failureThreshold: 5,
        resetTimeout: 60_000,
        halfOpenMaxAttempts: 3,
      })
    }

    // Monitor queue events
    this.queue.on('active', () => {
      this.metrics.queueDepth = this.queue.size + this.queue.pending
      this.metrics.inProgress = this.queue.pending
    })

    this.queue.on('idle', () => {
      this.metrics.queueDepth = 0
      this.metrics.inProgress = 0
      this.logger.debug('Reconciler queue idle')
    })

    this.logger.debug('ConcurrentReconciler initialized', {
      concurrency: this.options.concurrency,
      batchSize: this.options.batchSize,
      enableCircuitBreaker: this.options.enableCircuitBreaker,
      enablePriorityQueue: this.options.enablePriorityQueue,
      enableCache: this.options.enableCache,
    })
  }

  /**
   * Reconcile deployments concurrently
   */
  async reconcileDeployments(
    deployments: SubgraphDeploymentID[],
    activeAllocations: Allocation[],
    network: Network,
    operator: Operator,
  ): Promise<ReconciliationResult[]> {
    this.ensureNotDisposed()

    const startTime = Date.now()
    this.logger.info('Starting concurrent deployment reconciliation', {
      deployments: deployments.length,
      concurrency: this.options.concurrency,
    })

    const results: ReconciliationResult[] = []

    // Process deployments with concurrency control
    const tasks = deployments.map((deployment) => async () => {
      const result = await this.processDeployment(
        deployment,
        activeAllocations,
        network,
        operator,
      )
      results.push(result)
      return result
    })

    await this.queue.addAll(tasks)
    await this.queue.onIdle()

    const duration = Date.now() - startTime
    const successCount = results.filter((r) => r.success).length

    this.logger.info('Completed deployment reconciliation', {
      deployments: deployments.length,
      successful: successCount,
      failed: results.length - successCount,
      duration,
    })

    return results
  }

  /**
   * Reconcile allocation decisions with priority and concurrency
   */
  async reconcileAllocationDecisions(
    decisions: AllocationDecision[],
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<ReconciliationResult[]> {
    this.ensureNotDisposed()

    const startTime = Date.now()
    this.logger.info('Starting concurrent allocation reconciliation', {
      decisions: decisions.length,
      usePriorityQueue: this.options.enablePriorityQueue,
    })

    const results: ReconciliationResult[] = []

    if (this.options.enablePriorityQueue && this.priorityQueue) {
      // Use priority queue for intelligent ordering
      this.priorityQueue.enqueueBatch(decisions)

      while (!this.priorityQueue.isEmpty()) {
        const batch = this.priorityQueue.dequeueBatch(this.options.batchSize)
        if (batch.length === 0) break

        const batchResults = await this.processAllocationBatch(
          batch,
          activeAllocations,
          epoch,
          maxAllocationEpochs,
          network,
          operator,
        )
        results.push(...batchResults)
      }
    } else {
      // Process with standard concurrency
      const batchResults = await pMap(
        decisions,
        async (decision) => {
          return this.processAllocationDecision(
            decision,
            activeAllocations,
            epoch,
            maxAllocationEpochs,
            network,
            operator,
          )
        },
        { concurrency: this.options.concurrency },
      )
      results.push(...batchResults)
    }

    const duration = Date.now() - startTime
    const successCount = results.filter((r) => r.success).length

    this.logger.info('Completed allocation reconciliation', {
      decisions: decisions.length,
      successful: successCount,
      failed: results.length - successCount,
      duration,
    })

    return results
  }

  /**
   * Process a single deployment with retry logic
   */
  private async processDeployment(
    deployment: SubgraphDeploymentID,
    activeAllocations: Allocation[],
    network: Network,
    operator: Operator,
  ): Promise<ReconciliationResult> {
    const startTime = Date.now()
    const deploymentId = deployment.ipfsHash
    let lastError: Error | undefined
    let retries = 0

    // Check if already processing
    const existingWorker = this.workers.get(deploymentId)
    if (existingWorker) {
      this.logger.trace('Waiting for existing worker', { deployment: deploymentId })
      return existingWorker
    }

    // Check cache to avoid duplicate processing
    if (this.cache?.has(`deployment-${deploymentId}`)) {
      this.logger.trace('Skipping cached deployment', { deployment: deploymentId })
      return {
        deployment: deploymentId,
        success: true,
        duration: 0,
        retries: 0,
      }
    }

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        const executeReconciliation = async (): Promise<void> => {
          await this.reconcileDeploymentInternal(
            deployment,
            activeAllocations,
            network,
            operator,
          )
        }

        // Use circuit breaker if enabled
        if (this.circuitBreaker) {
          await this.circuitBreaker.execute(executeReconciliation)
        } else {
          await executeReconciliation()
        }

        // Cache successful result
        if (this.cache) {
          this.cache.set(`deployment-${deploymentId}`, true)
        }

        this.metrics.successful++
        this.metrics.totalProcessed++
        this.updateAverageProcessingTime(Date.now() - startTime)

        return {
          deployment: deploymentId,
          success: true,
          duration: Date.now() - startTime,
          retries,
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        retries = attempt

        this.logger.warn(`Deployment reconciliation attempt ${attempt} failed`, {
          deployment: deploymentId,
          attempt,
          maxAttempts: this.options.retryAttempts,
          error: lastError.message,
        })

        if (attempt < this.options.retryAttempts) {
          const delay =
            this.options.retryDelay *
            Math.pow(this.options.retryBackoffMultiplier, attempt - 1)
          await this.delay(delay)
        }
      }
    }

    // All retries failed
    this.metrics.failed++
    this.metrics.totalProcessed++

    this.logger.error('Deployment reconciliation failed after all retries', {
      deployment: deploymentId,
      retries,
      error: lastError?.message,
    })

    return {
      deployment: deploymentId,
      success: false,
      error: lastError,
      duration: Date.now() - startTime,
      retries,
    }
  }

  /**
   * Internal deployment reconciliation logic
   */
  private async reconcileDeploymentInternal(
    deployment: SubgraphDeploymentID,
    activeAllocations: Allocation[],
    network: Network,
    operator: Operator,
  ): Promise<void> {
    this.logger.trace('Reconciling deployment', {
      deployment: deployment.ipfsHash,
      network: network.specification.networkIdentifier,
    })

    // Find allocations for this deployment
    const deploymentAllocations = activeAllocations.filter(
      (allocation) => allocation.subgraphDeployment.id.bytes32 === deployment.bytes32,
    )

    // Get indexing rules for the deployment
    const rules = await operator.indexingRules(true)
    const deploymentRule = rules.find(
      (rule) => rule.identifier === deployment.ipfsHash || rule.identifier === 'global',
    )

    if (!deploymentRule) {
      this.logger.trace('No indexing rule found for deployment', {
        deployment: deployment.ipfsHash,
      })
      return
    }

    // Log reconciliation details
    this.logger.debug('Deployment reconciliation details', {
      deployment: deployment.ipfsHash,
      existingAllocations: deploymentAllocations.length,
      rule: deploymentRule.identifier,
    })
  }

  /**
   * Process a batch of allocation decisions
   */
  private async processAllocationBatch(
    batch: AllocationDecision[],
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<ReconciliationResult[]> {
    return pMap(
      batch,
      async (decision) => {
        return this.processAllocationDecision(
          decision,
          activeAllocations,
          epoch,
          maxAllocationEpochs,
          network,
          operator,
        )
      },
      { concurrency: Math.min(this.options.concurrency, batch.length) },
    )
  }

  /**
   * Process a single allocation decision
   */
  private async processAllocationDecision(
    decision: AllocationDecision,
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<ReconciliationResult> {
    const startTime = Date.now()
    const deploymentId = decision.deployment.ipfsHash
    const cacheKey = `allocation-${deploymentId}-${epoch}`

    // Check cache for recent processing
    if (this.cache?.has(cacheKey)) {
      this.logger.trace('Skipping cached allocation decision', {
        deployment: deploymentId,
      })
      return {
        deployment: deploymentId,
        success: true,
        duration: 0,
        retries: 0,
      }
    }

    try {
      // Process the allocation decision
      await this.reconcileAllocationInternal(
        decision,
        activeAllocations,
        epoch,
        maxAllocationEpochs,
        network,
        operator,
      )

      // Cache successful result
      if (this.cache) {
        this.cache.set(cacheKey, true)
      }

      this.metrics.successful++
      this.metrics.totalProcessed++
      this.updateAverageProcessingTime(Date.now() - startTime)

      return {
        deployment: deploymentId,
        success: true,
        duration: Date.now() - startTime,
        retries: 0,
      }
    } catch (error) {
      this.metrics.failed++
      this.metrics.totalProcessed++

      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error('Failed to process allocation decision', {
        deployment: deploymentId,
        error: err.message,
      })

      return {
        deployment: deploymentId,
        success: false,
        error: err,
        duration: Date.now() - startTime,
        retries: 0,
      }
    }
  }

  /**
   * Internal allocation reconciliation logic
   */
  private async reconcileAllocationInternal(
    decision: AllocationDecision,
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<void> {
    const deploymentId = decision.deployment.ipfsHash

    this.logger.trace('Processing allocation decision', {
      deployment: deploymentId,
      toAllocate: decision.toAllocate,
      epoch,
      maxAllocationEpochs,
      network: network.specification.networkIdentifier,
    })

    // Find existing allocations for this deployment
    const existingAllocations = activeAllocations.filter(
      (allocation) =>
        allocation.subgraphDeployment.id.bytes32 === decision.deployment.bytes32,
    )

    if (decision.toAllocate) {
      // Check if we need to create a new allocation
      if (existingAllocations.length === 0) {
        this.logger.debug('Would create allocation', {
          deployment: deploymentId,
          rule: decision.ruleMatch.rule?.identifier,
        })

        // In production, this would call operator.createAllocation()
        // The actual implementation should be done in the agent
      } else {
        this.logger.trace('Allocation already exists', {
          deployment: deploymentId,
          allocationCount: existingAllocations.length,
        })
      }
    } else {
      // Check if we need to close allocations
      for (const allocation of existingAllocations) {
        const allocationAge = epoch - allocation.createdAtEpoch
        const isExpiring = allocationAge >= maxAllocationEpochs - 1

        if (isExpiring) {
          this.logger.debug('Would close expiring allocation', {
            deployment: deploymentId,
            allocationId: allocation.id,
            age: allocationAge,
            maxEpochs: maxAllocationEpochs,
          })

          // In production, this would queue an action to close the allocation
        }
      }
    }
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Update average processing time metric using exponential moving average
   */
  private updateAverageProcessingTime(processingTime: number): void {
    const alpha = 0.1
    this.metrics.averageProcessingTime =
      alpha * processingTime + (1 - alpha) * this.metrics.averageProcessingTime
  }

  /**
   * Get reconciliation metrics
   */
  getMetrics(): Readonly<
    ReconciliationMetrics & {
      cacheHitRate: number
      circuitBreakerState: string
      priorityQueueSize: number
    }
  > {
    return {
      ...this.metrics,
      cacheHitRate: this.cache?.getHitRate() ?? 0,
      circuitBreakerState: this.circuitBreaker?.getState() ?? 'N/A',
      priorityQueueSize: this.priorityQueue?.size() ?? 0,
    }
  }

  /**
   * Pause reconciliation
   */
  pause(): void {
    this.ensureNotDisposed()
    this.queue.pause()
    this.logger.info('Reconciliation paused')
  }

  /**
   * Resume reconciliation
   */
  resume(): void {
    this.ensureNotDisposed()
    this.queue.start()
    this.logger.info('Reconciliation resumed')
  }

  /**
   * Check if reconciler is paused
   */
  isPaused(): boolean {
    return this.queue.isPaused
  }

  /**
   * Clear all queues and caches
   */
  clear(): void {
    this.queue.clear()
    this.priorityQueue?.clear()
    this.cache?.clear()
    this.workers.clear()
    this.logger.info('Reconciler cleared')
  }

  /**
   * Wait for all pending operations to complete
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle()
    await Promise.all(this.workers.values())
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): { size: number; pending: number; isPaused: boolean } {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
    }
  }

  /**
   * Ensure reconciler is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('ConcurrentReconciler has been disposed')
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.disposed) return

    this.disposed = true

    this.queue.clear()
    this.priorityQueue?.dispose()
    this.cache?.dispose()
    this.circuitBreaker?.dispose()
    this.workers.clear()

    this.logger.debug('ConcurrentReconciler disposed')
  }

  /**
   * Support for async disposal
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.onIdle()
    this.dispose()
  }
}
