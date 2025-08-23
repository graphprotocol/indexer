/**
 * Performance configuration for the indexer agent
 * These values can be overridden via environment variables
 */

import { cpus, totalmem } from 'os'

export interface PerformanceConfig {
  // Concurrency settings
  allocationConcurrency: number
  deploymentConcurrency: number
  networkQueryConcurrency: number
  batchSize: number

  // Cache settings
  enableCache: boolean
  cacheTTL: number
  cacheMaxSize: number
  cacheCleanupInterval: number

  // Circuit breaker settings
  enableCircuitBreaker: boolean
  circuitBreakerFailureThreshold: number
  circuitBreakerResetTimeout: number
  circuitBreakerHalfOpenMaxAttempts: number

  // Priority queue settings
  enablePriorityQueue: boolean
  priorityQueueSignalThreshold: string
  priorityQueueStakeThreshold: string

  // Network settings
  enableParallelNetworkQueries: boolean
  networkQueryBatchSize: number
  networkQueryTimeout: number

  // Retry settings
  maxRetryAttempts: number
  retryDelay: number
  retryBackoffMultiplier: number

  // Monitoring settings
  enableMetrics: boolean
  metricsInterval: number
  enableDetailedLogging: boolean
}

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  // Concurrency settings
  allocationConcurrency: 20,
  deploymentConcurrency: 15,
  networkQueryConcurrency: 10,
  batchSize: 10,

  // Cache settings
  enableCache: true,
  cacheTTL: 30000, // 30 seconds
  cacheMaxSize: 2000,
  cacheCleanupInterval: 60000, // 1 minute

  // Circuit breaker settings
  enableCircuitBreaker: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeout: 60000, // 1 minute
  circuitBreakerHalfOpenMaxAttempts: 3,

  // Priority queue settings
  enablePriorityQueue: true,
  priorityQueueSignalThreshold: '1000000000000000000000', // 1000 GRT
  priorityQueueStakeThreshold: '10000000000000000000000', // 10000 GRT

  // Network settings
  enableParallelNetworkQueries: true,
  networkQueryBatchSize: 50,
  networkQueryTimeout: 30000, // 30 seconds

  // Retry settings
  maxRetryAttempts: 3,
  retryDelay: 1000, // 1 second
  retryBackoffMultiplier: 2,

  // Monitoring settings
  enableMetrics: true,
  metricsInterval: 60000, // 1 minute
  enableDetailedLogging: false,
}

/**
 * Load performance configuration from environment variables
 */
export function loadPerformanceConfig(): PerformanceConfig {
  const config = { ...DEFAULT_PERFORMANCE_CONFIG }

  // Override with environment variables if present
  if (process.env.ALLOCATION_CONCURRENCY) {
    config.allocationConcurrency = parseInt(process.env.ALLOCATION_CONCURRENCY)
  }

  if (process.env.DEPLOYMENT_CONCURRENCY) {
    config.deploymentConcurrency = parseInt(process.env.DEPLOYMENT_CONCURRENCY)
  }

  if (process.env.NETWORK_QUERY_CONCURRENCY) {
    config.networkQueryConcurrency = parseInt(
      process.env.NETWORK_QUERY_CONCURRENCY,
    )
  }

  if (process.env.BATCH_SIZE) {
    config.batchSize = parseInt(process.env.BATCH_SIZE)
  }

  if (process.env.ENABLE_CACHE !== undefined) {
    config.enableCache = process.env.ENABLE_CACHE !== 'false'
  }

  if (process.env.CACHE_TTL) {
    config.cacheTTL = parseInt(process.env.CACHE_TTL)
  }

  if (process.env.CACHE_MAX_SIZE) {
    config.cacheMaxSize = parseInt(process.env.CACHE_MAX_SIZE)
  }

  if (process.env.ENABLE_CIRCUIT_BREAKER !== undefined) {
    config.enableCircuitBreaker = process.env.ENABLE_CIRCUIT_BREAKER !== 'false'
  }

  if (process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    config.circuitBreakerFailureThreshold = parseInt(
      process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    )
  }

  if (process.env.CIRCUIT_BREAKER_RESET_TIMEOUT) {
    config.circuitBreakerResetTimeout = parseInt(
      process.env.CIRCUIT_BREAKER_RESET_TIMEOUT,
    )
  }

  if (process.env.ENABLE_PRIORITY_QUEUE !== undefined) {
    config.enablePriorityQueue = process.env.ENABLE_PRIORITY_QUEUE !== 'false'
  }

  if (process.env.PRIORITY_QUEUE_SIGNAL_THRESHOLD) {
    config.priorityQueueSignalThreshold =
      process.env.PRIORITY_QUEUE_SIGNAL_THRESHOLD
  }

  if (process.env.PRIORITY_QUEUE_STAKE_THRESHOLD) {
    config.priorityQueueStakeThreshold =
      process.env.PRIORITY_QUEUE_STAKE_THRESHOLD
  }

  if (process.env.ENABLE_PARALLEL_NETWORK_QUERIES !== undefined) {
    config.enableParallelNetworkQueries =
      process.env.ENABLE_PARALLEL_NETWORK_QUERIES !== 'false'
  }

  if (process.env.NETWORK_QUERY_BATCH_SIZE) {
    config.networkQueryBatchSize = parseInt(
      process.env.NETWORK_QUERY_BATCH_SIZE,
    )
  }

  if (process.env.NETWORK_QUERY_TIMEOUT) {
    config.networkQueryTimeout = parseInt(process.env.NETWORK_QUERY_TIMEOUT)
  }

  if (process.env.MAX_RETRY_ATTEMPTS) {
    config.maxRetryAttempts = parseInt(process.env.MAX_RETRY_ATTEMPTS)
  }

  if (process.env.RETRY_DELAY) {
    config.retryDelay = parseInt(process.env.RETRY_DELAY)
  }

  if (process.env.RETRY_BACKOFF_MULTIPLIER) {
    config.retryBackoffMultiplier = parseFloat(
      process.env.RETRY_BACKOFF_MULTIPLIER,
    )
  }

  if (process.env.ENABLE_METRICS !== undefined) {
    config.enableMetrics = process.env.ENABLE_METRICS !== 'false'
  }

  if (process.env.METRICS_INTERVAL) {
    config.metricsInterval = parseInt(process.env.METRICS_INTERVAL)
  }

  if (process.env.ENABLE_DETAILED_LOGGING !== undefined) {
    config.enableDetailedLogging =
      process.env.ENABLE_DETAILED_LOGGING === 'true'
  }

  return config
}

/**
 * Validate performance configuration
 */
export function validatePerformanceConfig(config: PerformanceConfig): void {
  if (config.allocationConcurrency < 1 || config.allocationConcurrency > 100) {
    throw new Error('allocationConcurrency must be between 1 and 100')
  }

  if (config.deploymentConcurrency < 1 || config.deploymentConcurrency > 50) {
    throw new Error('deploymentConcurrency must be between 1 and 50')
  }

  if (config.batchSize < 1 || config.batchSize > 100) {
    throw new Error('batchSize must be between 1 and 100')
  }

  if (config.cacheTTL < 1000 || config.cacheTTL > 300000) {
    throw new Error('cacheTTL must be between 1000ms and 300000ms (5 minutes)')
  }

  if (config.cacheMaxSize < 100 || config.cacheMaxSize > 10000) {
    throw new Error('cacheMaxSize must be between 100 and 10000')
  }

  if (
    config.circuitBreakerFailureThreshold < 1 ||
    config.circuitBreakerFailureThreshold > 20
  ) {
    throw new Error('circuitBreakerFailureThreshold must be between 1 and 20')
  }

  if (config.maxRetryAttempts < 0 || config.maxRetryAttempts > 10) {
    throw new Error('maxRetryAttempts must be between 0 and 10')
  }
}

/**
 * Get optimized configuration based on system resources
 */
export function getOptimizedConfig(): PerformanceConfig {
  const config = loadPerformanceConfig()

  // Adjust based on available system resources
  const cpuCount = cpus().length
  const totalMemory = totalmem()

  // Adjust concurrency based on CPU cores
  if (cpuCount >= 8) {
    config.allocationConcurrency = Math.min(
      30,
      config.allocationConcurrency * 1.5,
    )
    config.deploymentConcurrency = Math.min(
      25,
      config.deploymentConcurrency * 1.5,
    )
  } else if (cpuCount <= 2) {
    config.allocationConcurrency = Math.max(
      5,
      config.allocationConcurrency * 0.5,
    )
    config.deploymentConcurrency = Math.max(
      5,
      config.deploymentConcurrency * 0.5,
    )
  }

  // Adjust cache size based on available memory
  const memoryGB = totalMemory / (1024 * 1024 * 1024)
  if (memoryGB >= 16) {
    config.cacheMaxSize = Math.min(5000, config.cacheMaxSize * 2)
  } else if (memoryGB <= 4) {
    config.cacheMaxSize = Math.max(500, config.cacheMaxSize * 0.5)
  }

  return config
}
