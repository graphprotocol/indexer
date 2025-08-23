import { Logger } from '@graphprotocol/common-ts'

export interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeout?: number
  halfOpenMaxAttempts?: number
  monitoringPeriod?: number
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitStats {
  failures: number
  successes: number
  lastFailureTime: number
  consecutiveFailures: number
  totalRequests: number
}

/**
 * Circuit Breaker pattern implementation for resilient network calls
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private stats: CircuitStats = {
    failures: 0,
    successes: 0,
    lastFailureTime: 0,
    consecutiveFailures: 0,
    totalRequests: 0,
  }
  private halfOpenAttempts = 0
  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenMaxAttempts: number
  private readonly monitoringPeriod: number
  private logger: Logger
  private stateChangeCallbacks: Array<(state: CircuitState) => void> = []

  constructor(logger: Logger, options: CircuitBreakerOptions = {}) {
    this.logger = logger.child({ component: 'CircuitBreaker' })
    this.failureThreshold = options.failureThreshold || 5
    this.resetTimeout = options.resetTimeout || 60000 // 1 minute
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 3
    this.monitoringPeriod = options.monitoringPeriod || 300000 // 5 minutes

    // Periodic stats reset
    setInterval(() => this.resetStats(), this.monitoringPeriod)
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    this.stats.totalRequests++

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (Date.now() - this.stats.lastFailureTime >= this.resetTimeout) {
        this.transitionTo('HALF_OPEN')
      } else if (fallback) {
        this.logger.debug('Circuit is OPEN, using fallback')
        return fallback()
      } else {
        throw new Error(`Circuit breaker is OPEN. Reset in ${Math.ceil((this.resetTimeout - (Date.now() - this.stats.lastFailureTime)) / 1000)
          } seconds`)
      }
    }

    // Handle HALF_OPEN state
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.transitionTo('OPEN')
        if (fallback) {
          return fallback()
        }
        throw new Error('Circuit breaker is OPEN after max half-open attempts')
      }
      this.halfOpenAttempts++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()

      // Try fallback if available
      if (fallback && this.state === 'OPEN') {
        this.logger.warn('Execution failed, using fallback', { error })
        return fallback()
      }

      throw error
    }
  }

  /**
   * Execute multiple operations with circuit breaker protection
   */
  async executeBatch<T>(
    operations: Array<() => Promise<T>>,
    options: { concurrency?: number; stopOnFailure?: boolean } = {},
  ): Promise<Array<{ success: boolean; result?: T; error?: Error }>> {
    const { concurrency = 5, stopOnFailure = false } = options
    const results: Array<{ success: boolean; result?: T; error?: Error }> = []

    const chunks: Array<Array<() => Promise<T>>> = []
    for (let i = 0; i < operations.length; i += concurrency) {
      chunks.push(operations.slice(i, i + concurrency))
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(op => this.execute(op))
      )

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push({ success: true, result: result.value })
        } else {
          results.push({ success: false, error: result.reason })
          if (stopOnFailure) {
            return results
          }
        }
      }

      // Stop if circuit is open
      if (this.state === 'OPEN' && stopOnFailure) {
        break
      }
    }

    return results
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get circuit statistics
   */
  getStats(): Readonly<CircuitStats> {
    return { ...this.stats }
  }

  /**
   * Get circuit health percentage
   */
  getHealthPercentage(): number {
    if (this.stats.totalRequests === 0) return 100
    return ((this.stats.successes / this.stats.totalRequests) * 100)
  }

  /**
   * Force circuit to open
   */
  trip(): void {
    this.transitionTo('OPEN')
  }

  /**
   * Force circuit to close
   */
  reset(): void {
    this.transitionTo('CLOSED')
    this.stats.consecutiveFailures = 0
    this.halfOpenAttempts = 0
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (state: CircuitState) => void): void {
    this.stateChangeCallbacks.push(callback)
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.stats.successes++
    this.stats.consecutiveFailures = 0

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts = 0
      this.transitionTo('CLOSED')
      this.logger.info('Circuit recovered, transitioning to CLOSED')
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.stats.failures++
    this.stats.consecutiveFailures++
    this.stats.lastFailureTime = Date.now()

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.transitionTo('OPEN')
        this.logger.warn('Circuit failed in HALF_OPEN state, transitioning to OPEN')
      }
    } else if (
      this.state === 'CLOSED' &&
      this.stats.consecutiveFailures >= this.failureThreshold
    ) {
      this.transitionTo('OPEN')
      this.logger.error('Circuit breaker tripped, transitioning to OPEN', {
        consecutiveFailures: this.stats.consecutiveFailures,
        threshold: this.failureThreshold,
      })
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState

    if (oldState !== newState) {
      this.logger.info('Circuit state changed', { from: oldState, to: newState })
      this.stateChangeCallbacks.forEach(cb => cb(newState))

      if (newState === 'HALF_OPEN') {
        this.halfOpenAttempts = 0
      }
    }
  }

  /**
   * Reset statistics periodically
   */
  private resetStats(): void {
    // Keep failure tracking but reset totals for percentage calculations
    this.stats.totalRequests = 0
    this.stats.successes = 0
    this.stats.failures = 0
  }

  /**
   * Create a wrapped function with circuit breaker protection
   */
  wrap<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
    fallback?: (...args: Parameters<T>) => ReturnType<T> | Promise<Awaited<ReturnType<T>>>,
  ): T {
    return (async (...args: Parameters<T>) => {
      return this.execute(
        () => fn(...args),
        fallback ? () => fallback(...args) : undefined,
      )
    }) as T
  }
}
