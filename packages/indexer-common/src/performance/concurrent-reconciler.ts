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
  enableCircuitBreaker?: boolean
  enablePriorityQueue?: boolean
  enableCache?: boolean
}

export interface ReconciliationMetrics {
  totalProcessed: number
  successful: number
  failed: number
  averageProcessingTime: number
  queueDepth: number
}

/**
 * Concurrent reconciler for high-throughput allocation processing
 */
export class ConcurrentReconciler {
  private readonly logger: Logger
  private readonly queue: PQueue
  private readonly priorityQueue?: AllocationPriorityQueue
  private readonly cache?: NetworkDataCache
  private readonly circuitBreaker?: CircuitBreaker
  private readonly workers = new Map<string, Promise<void>>()
  private metrics: ReconciliationMetrics = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    averageProcessingTime: 0,
    queueDepth: 0,
  }
  private readonly options: Required<ReconcilerOptions>

  constructor(logger: Logger, options: ReconcilerOptions = {}) {
    this.logger = logger.child({ component: 'ConcurrentReconciler' })
    
    this.options = {
      concurrency: options.concurrency || 20,
      batchSize: options.batchSize || 10,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      enableCircuitBreaker: options.enableCircuitBreaker !== false,
      enablePriorityQueue: options.enablePriorityQueue !== false,
      enableCache: options.enableCache !== false,
    }

    // Initialize queue with concurrency control
    this.queue = new PQueue({ concurrency: this.options.concurrency })

    // Initialize optional components
    if (this.options.enablePriorityQueue) {
      this.priorityQueue = new AllocationPriorityQueue(this.logger)
    }

    if (this.options.enableCache) {
      this.cache = new NetworkDataCache(this.logger, {
        ttl: 30000,
        maxSize: 1000,
        enableMetrics: true,
      })
    }

    if (this.options.enableCircuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(this.logger, {
        failureThreshold: 5,
        resetTimeout: 60000,
      })
    }

    // Monitor queue events
    this.queue.on('active', () => {
      this.metrics.queueDepth = this.queue.size + this.queue.pending
      this.logger.trace('Queue active', {
        size: this.queue.size,
        pending: this.queue.pending,
      })
    })

    this.queue.on('idle', () => {
      this.metrics.queueDepth = 0
      this.logger.debug('Queue idle')
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
  ): Promise<void> {
    const startTime = Date.now()
    this.logger.info('Starting concurrent deployment reconciliation', {
      deployments: deployments.length,
      concurrency: this.options.concurrency,
    })

    // Split deployments into batches
    const batches = this.createBatches(deployments, this.options.batchSize)
    
    // Process batches concurrently
    await Promise.all(
      batches.map(batch => 
        this.processBatch(batch, activeAllocations, network, operator)
      )
    )

    const duration = Date.now() - startTime
    this.logger.info('Completed deployment reconciliation', {
      deployments: deployments.length,
      duration,
      metrics: this.getMetrics(),
    })
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
  ): Promise<void> {
    const startTime = Date.now()
    this.logger.info('Starting concurrent allocation reconciliation', {
      decisions: decisions.length,
      usePriorityQueue: this.options.enablePriorityQueue,
    })

    if (this.options.enablePriorityQueue && this.priorityQueue) {
      // Use priority queue for intelligent ordering
      this.priorityQueue.enqueueBatch(decisions)
      
      while (!this.priorityQueue.isEmpty()) {
        const batch = this.priorityQueue.dequeueBatch(this.options.batchSize)
        if (batch.length === 0) break
        
        await this.processAllocationBatch(
          batch,
          activeAllocations,
          epoch,
          maxAllocationEpochs,
          network,
          operator,
        )
      }
    } else {
      // Process with standard concurrency
      await pMap(
        decisions,
        async (decision) => {
          await this.processAllocationDecision(
            decision,
            activeAllocations,
            epoch,
            maxAllocationEpochs,
            network,
            operator,
          )
        },
        { concurrency: this.options.concurrency }
      )
    }

    const duration = Date.now() - startTime
    this.logger.info('Completed allocation reconciliation', {
      decisions: decisions.length,
      duration,
      metrics: this.getMetrics(),
    })
  }

  /**
   * Process a batch of deployments
   */
  private async processBatch(
    batch: SubgraphDeploymentID[],
    activeAllocations: Allocation[],
    network: Network,
    operator: Operator,
  ): Promise<void> {
    const tasks = batch.map(deployment => async () => {
      const workerId = deployment.ipfsHash
      
      try {
        // Check if already processing
        if (this.workers.has(workerId)) {
          await this.workers.get(workerId)
          return
        }

        const workerPromise = this.processDeployment(
          deployment,
          activeAllocations,
          network,
          operator,
        )
        
        this.workers.set(workerId, workerPromise)
        await workerPromise
        
      } finally {
        this.workers.delete(workerId)
      }
    })

    await this.queue.addAll(tasks)
  }

  /**
   * Process a single deployment with retry logic
   */
  private async processDeployment(
    deployment: SubgraphDeploymentID,
    activeAllocations: Allocation[],
    network: Network,
    operator: Operator,
  ): Promise<void> {
    const startTime = Date.now()
    
    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        // Use circuit breaker if enabled
        if (this.circuitBreaker) {
          await this.circuitBreaker.execute(async () => {
            await this.reconcileDeploymentInternal(
              deployment,
              activeAllocations,
              network,
              operator,
            )
          })
        } else {
          await this.reconcileDeploymentInternal(
            deployment,
            activeAllocations,
            network,
            operator,
          )
        }

        this.metrics.successful++
        this.updateAverageProcessingTime(Date.now() - startTime)
        return
        
      } catch (error) {
        this.logger.warn(`Deployment reconciliation attempt ${attempt} failed`, {
          deployment: deployment.ipfsHash,
          attempt,
          error,
        })

        if (attempt < this.options.retryAttempts) {
          await this.delay(this.options.retryDelay * attempt)
        } else {
          this.metrics.failed++
          this.logger.error('Deployment reconciliation failed after all retries', {
            deployment: deployment.ipfsHash,
            error,
          })
          throw error
        }
      }
    }
    
    this.metrics.totalProcessed++
  }

  /**
   * Internal deployment reconciliation logic
   */
  private async reconcileDeploymentInternal(
    deployment: SubgraphDeploymentID,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _activeAllocations: Allocation[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _network: Network,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _operator: Operator,
  ): Promise<void> {
    // Implementation would include actual reconciliation logic
    // This is a placeholder for the core logic
    this.logger.trace('Reconciling deployment', {
      deployment: deployment.ipfsHash,
    })
    
    // Add actual reconciliation logic here
    // This would interact with the network and operator
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
  ): Promise<void> {
    await pMap(
      batch,
      async (decision) => {
        await this.processAllocationDecision(
          decision,
          activeAllocations,
          epoch,
          maxAllocationEpochs,
          network,
          operator,
        )
      },
      { concurrency: Math.min(this.options.concurrency, batch.length) }
    )
  }

  /**
   * Process a single allocation decision
   */
  private async processAllocationDecision(
    decision: AllocationDecision,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _activeAllocations: Allocation[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _epoch: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _maxAllocationEpochs: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _network: Network,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _operator: Operator,
  ): Promise<void> {
    const startTime = Date.now()
    
    try {
      // Use cache if enabled
      if (this.cache) {
        const cacheKey = `allocation-${decision.deployment.ipfsHash}`
        const cached = this.cache.get<boolean>(cacheKey)
        
        if (cached !== undefined) {
          this.logger.trace('Using cached allocation decision', {
            deployment: decision.deployment.ipfsHash,
          })
          return
        }
      }

      // Process the allocation decision
      // This would include the actual reconciliation logic
      this.logger.trace('Processing allocation decision', {
        deployment: decision.deployment.ipfsHash,
        toAllocate: decision.toAllocate,
      })

      // Cache the result if successful
      if (this.cache) {
        const cacheKey = `allocation-${decision.deployment.ipfsHash}`
        this.cache.set(cacheKey, true)
      }

      this.metrics.successful++
      this.updateAverageProcessingTime(Date.now() - startTime)
      
    } catch (error) {
      this.metrics.failed++
      this.logger.error('Failed to process allocation decision', {
        deployment: decision.deployment.ipfsHash,
        error,
      })
      throw error
    } finally {
      this.metrics.totalProcessed++
    }
  }

  /**
   * Create batches from an array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Update average processing time metric
   */
  private updateAverageProcessingTime(processingTime: number): void {
    const alpha = 0.1 // Exponential moving average factor
    this.metrics.averageProcessingTime =
      alpha * processingTime + (1 - alpha) * this.metrics.averageProcessingTime
  }

  /**
   * Get reconciliation metrics
   */
  getMetrics(): Readonly<ReconciliationMetrics & { cacheHitRate: number; circuitBreakerState: string; queueSize: number }> {
    return {
      ...this.metrics,
      cacheHitRate: this.cache?.getHitRate() || 0,
      circuitBreakerState: this.circuitBreaker?.getState() || 'N/A',
      queueSize: this.priorityQueue?.size() || 0,
    }
  }

  /**
   * Pause reconciliation
   */
  pause(): void {
    this.queue.pause()
    this.logger.info('Reconciliation paused')
  }

  /**
   * Resume reconciliation
   */
  resume(): void {
    this.queue.start()
    this.logger.info('Reconciliation resumed')
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
}