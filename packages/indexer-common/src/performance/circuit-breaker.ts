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
  lastStateChange: number
}

// Default configuration constants
const CIRCUIT_BREAKER_DEFAULTS = {
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 60_000, // 1 minute
  HALF_OPEN_MAX_ATTEMPTS: 3,
  MONITORING_PERIOD: 300_000, // 5 minutes
} as const

/**
 * Circuit Breaker pattern implementation for resilient network calls.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Failure threshold exceeded, requests fail fast or use fallback
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * Features:
 * - Automatic state transitions based on failure/success patterns
 * - Configurable thresholds and timeouts
 * - Fallback support for graceful degradation
 * - Metrics and health tracking
 * - Batch operation support
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private stats: CircuitStats = {
    failures: 0,
    successes: 0,
    lastFailureTime: 0,
    consecutiveFailures: 0,
    totalRequests: 0,
    lastStateChange: Date.now(),
  }
  private halfOpenAttempts = 0
  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenMaxAttempts: number
  private readonly monitoringPeriod: number
  private logger: Logger
  private stateChangeCallbacks: Array<(state: CircuitState, previousState: CircuitState) => void> =
    []
  private monitoringInterval?: NodeJS.Timeout
  private disposed = false

  constructor(logger: Logger, options: CircuitBreakerOptions = {}) {
    this.logger = logger.child({ component: 'CircuitBreaker' })
    this.failureThreshold = options.failureThreshold ?? CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD
    this.resetTimeout = options.resetTimeout ?? CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT
    this.halfOpenMaxAttempts =
      options.halfOpenMaxAttempts ?? CIRCUIT_BREAKER_DEFAULTS.HALF_OPEN_MAX_ATTEMPTS
    this.monitoringPeriod = options.monitoringPeriod ?? CIRCUIT_BREAKER_DEFAULTS.MONITORING_PERIOD

    // Periodic stats reset for rolling window
    this.monitoringInterval = setInterval(() => this.resetStats(), this.monitoringPeriod)

    // Ensure interval doesn't prevent process exit
    if (this.monitoringInterval.unref) {
      this.monitoringInterval.unref()
    }

    this.logger.debug('CircuitBreaker initialized', {
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      halfOpenMaxAttempts: this.halfOpenMaxAttempts,
      monitoringPeriod: this.monitoringPeriod,
    })
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    this.ensureNotDisposed()
    this.stats.totalRequests++

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.stats.lastFailureTime
      if (timeSinceLastFailure >= this.resetTimeout) {
        this.transitionTo('HALF_OPEN')
      } else if (fallback) {
        this.logger.debug('Circuit is OPEN, using fallback', {
          timeUntilReset: Math.ceil((this.resetTimeout - timeSinceLastFailure) / 1000),
        })
        return fallback()
      } else {
        const timeUntilReset = Math.ceil((this.resetTimeout - timeSinceLastFailure) / 1000)
        throw new CircuitOpenError(
          `Circuit breaker is OPEN. Reset in ${timeUntilReset} seconds`,
          timeUntilReset,
        )
      }
    }

    // Handle HALF_OPEN state
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.transitionTo('OPEN')
        if (fallback) {
          return fallback()
        }
        throw new CircuitOpenError('Circuit breaker is OPEN after max half-open attempts', 0)
      }
      this.halfOpenAttempts++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)

      // Try fallback if available and circuit is now open
      if (fallback && this.state === 'OPEN') {
        this.logger.warn('Execution failed, circuit opened, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        })
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
    this.ensureNotDisposed()

    const { concurrency = 5, stopOnFailure = false } = options
    const results: Array<{ success: boolean; result?: T; error?: Error }> = []

    // Split operations into chunks for controlled concurrency
    const chunks: Array<Array<() => Promise<T>>> = []
    for (let i = 0; i < operations.length; i += concurrency) {
      chunks.push(operations.slice(i, i + concurrency))
    }

    for (const chunk of chunks) {
      // Stop if circuit is open and stopOnFailure is true
      if (this.state === 'OPEN' && stopOnFailure) {
        this.logger.debug('Stopping batch execution, circuit is OPEN')
        break
      }

      const chunkResults = await Promise.allSettled(chunk.map((op) => this.execute(op)))

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push({ success: true, result: result.value })
        } else {
          const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason))
          results.push({ success: false, error })
          if (stopOnFailure) {
            return results
          }
        }
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
  getStats(): Readonly<CircuitStats & { healthPercentage: number; timeInCurrentState: number }> {
    return {
      ...this.stats,
      healthPercentage: this.getHealthPercentage(),
      timeInCurrentState: Date.now() - this.stats.lastStateChange,
    }
  }

  /**
   * Get circuit health percentage (0-100)
   */
  getHealthPercentage(): number {
    if (this.stats.totalRequests === 0) return 100
    return Math.round((this.stats.successes / this.stats.totalRequests) * 100)
  }

  /**
   * Check if circuit is healthy (CLOSED state)
   */
  isHealthy(): boolean {
    return this.state === 'CLOSED'
  }

  /**
   * Force circuit to open (manual trip)
   */
  trip(): void {
    this.ensureNotDisposed()
    this.logger.warn('Circuit manually tripped')
    this.transitionTo('OPEN')
  }

  /**
   * Force circuit to close (manual reset)
   */
  reset(): void {
    this.ensureNotDisposed()
    this.logger.info('Circuit manually reset')
    this.transitionTo('CLOSED')
    this.stats.consecutiveFailures = 0
    this.halfOpenAttempts = 0
  }

  /**
   * Register callback for state changes
   */
  onStateChange(
    callback: (state: CircuitState, previousState: CircuitState) => void,
  ): () => void {
    this.stateChangeCallbacks.push(callback)
    // Return unsubscribe function
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback)
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1)
      }
    }
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
  private onFailure(error: unknown): void {
    this.stats.failures++
    this.stats.consecutiveFailures++
    this.stats.lastFailureTime = Date.now()

    const errorMessage = error instanceof Error ? error.message : String(error)

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.transitionTo('OPEN')
        this.logger.warn('Circuit failed in HALF_OPEN state, transitioning to OPEN', {
          error: errorMessage,
          attempts: this.halfOpenAttempts,
        })
      }
    } else if (
      this.state === 'CLOSED' &&
      this.stats.consecutiveFailures >= this.failureThreshold
    ) {
      this.transitionTo('OPEN')
      this.logger.error('Circuit breaker tripped, transitioning to OPEN', {
        consecutiveFailures: this.stats.consecutiveFailures,
        threshold: this.failureThreshold,
        lastError: errorMessage,
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
      this.stats.lastStateChange = Date.now()
      this.logger.info('Circuit state changed', { from: oldState, to: newState })

      // Notify all registered callbacks
      for (const callback of this.stateChangeCallbacks) {
        try {
          callback(newState, oldState)
        } catch (err) {
          this.logger.warn('Error in state change callback', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      if (newState === 'HALF_OPEN') {
        this.halfOpenAttempts = 0
      }
    }
  }

  /**
   * Reset statistics periodically (rolling window)
   */
  private resetStats(): void {
    if (this.disposed) return

    // Keep failure tracking but reset totals for percentage calculations
    const previousTotal = this.stats.totalRequests
    this.stats.totalRequests = 0
    this.stats.successes = 0
    this.stats.failures = 0

    if (previousTotal > 0) {
      this.logger.trace('Reset circuit breaker stats', { previousTotal })
    }
  }

  /**
   * Create a wrapped function with circuit breaker protection
   */
  wrap<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    fallback?: (...args: TArgs) => TResult | Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      return this.execute(
        () => fn(...args),
        fallback ? () => fallback(...args) : undefined,
      )
    }
  }

  /**
   * Ensure circuit breaker is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('CircuitBreaker has been disposed')
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.disposed) return

    this.disposed = true

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = undefined
    }

    this.stateChangeCallbacks = []
    this.logger.debug('CircuitBreaker disposed')
  }

  /**
   * Support for async disposal
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose()
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly timeUntilReset: number,
  ) {
    super(message)
    this.name = 'CircuitOpenError'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CircuitOpenError)
    }
  }
}
