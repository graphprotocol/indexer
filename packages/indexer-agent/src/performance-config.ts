/**
 * Performance configuration for the indexer agent
 * These values can be overridden via environment variables
 */

import { cpus, totalmem } from 'os'

// Constants for performance configuration
const PERFORMANCE_DEFAULTS = {
  ALLOCATION_CONCURRENCY: 20,
  DEPLOYMENT_CONCURRENCY: 15,
  NETWORK_QUERY_CONCURRENCY: 10,
  BATCH_SIZE: 10,
  CACHE_TTL: 30_000, // 30 seconds
  CACHE_MAX_SIZE: 2000,
  CACHE_CLEANUP_INTERVAL: 60_000, // 1 minute
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 60_000, // 1 minute
  PRIORITY_QUEUE_SIGNAL_THRESHOLD: '1000000000000000000000', // 1000 GRT
  PRIORITY_QUEUE_STAKE_THRESHOLD: '10000000000000000000000', // 10000 GRT
  NETWORK_QUERY_BATCH_SIZE: 50,
  NETWORK_QUERY_TIMEOUT: 30_000, // 30 seconds
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
  RETRY_BACKOFF_MULTIPLIER: 2,
  METRICS_INTERVAL: 60_000, // 1 minute
} as const

/**
 * Utility function for parsing environment variables
 */
function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key]
  return value ? parseInt(value, 10) : defaultValue
}

function parseEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key]
  return value ? parseFloat(value) : defaultValue
}

function parseEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]
  if (value === undefined) return defaultValue
  return value !== 'false'
}

function parseEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

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
  allocationConcurrency: PERFORMANCE_DEFAULTS.ALLOCATION_CONCURRENCY,
  deploymentConcurrency: PERFORMANCE_DEFAULTS.DEPLOYMENT_CONCURRENCY,
  networkQueryConcurrency: PERFORMANCE_DEFAULTS.NETWORK_QUERY_CONCURRENCY,
  batchSize: PERFORMANCE_DEFAULTS.BATCH_SIZE,

  // Cache settings
  enableCache: true,
  cacheTTL: PERFORMANCE_DEFAULTS.CACHE_TTL,
  cacheMaxSize: PERFORMANCE_DEFAULTS.CACHE_MAX_SIZE,
  cacheCleanupInterval: PERFORMANCE_DEFAULTS.CACHE_CLEANUP_INTERVAL,

  // Circuit breaker settings
  enableCircuitBreaker: true,
  circuitBreakerFailureThreshold:
    PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  circuitBreakerResetTimeout:
    PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_RESET_TIMEOUT,
  circuitBreakerHalfOpenMaxAttempts: 3,

  // Priority queue settings
  enablePriorityQueue: true,
  priorityQueueSignalThreshold:
    PERFORMANCE_DEFAULTS.PRIORITY_QUEUE_SIGNAL_THRESHOLD,
  priorityQueueStakeThreshold:
    PERFORMANCE_DEFAULTS.PRIORITY_QUEUE_STAKE_THRESHOLD,

  // Network settings
  enableParallelNetworkQueries: true,
  networkQueryBatchSize: PERFORMANCE_DEFAULTS.NETWORK_QUERY_BATCH_SIZE,
  networkQueryTimeout: PERFORMANCE_DEFAULTS.NETWORK_QUERY_TIMEOUT,

  // Retry settings
  maxRetryAttempts: PERFORMANCE_DEFAULTS.MAX_RETRY_ATTEMPTS,
  retryDelay: PERFORMANCE_DEFAULTS.RETRY_DELAY,
  retryBackoffMultiplier: PERFORMANCE_DEFAULTS.RETRY_BACKOFF_MULTIPLIER,

  // Monitoring settings
  enableMetrics: true,
  metricsInterval: PERFORMANCE_DEFAULTS.METRICS_INTERVAL,
  enableDetailedLogging: false,
}

/**
 * Apply concurrency-related environment variable overrides
 */
function applyConcurrencySettings(config: PerformanceConfig): void {
  config.allocationConcurrency = parseEnvInt(
    'ALLOCATION_CONCURRENCY',
    config.allocationConcurrency,
  )
  config.deploymentConcurrency = parseEnvInt(
    'DEPLOYMENT_CONCURRENCY',
    config.deploymentConcurrency,
  )
  config.networkQueryConcurrency = parseEnvInt(
    'NETWORK_QUERY_CONCURRENCY',
    config.networkQueryConcurrency,
  )
  config.batchSize = parseEnvInt('BATCH_SIZE', config.batchSize)
}

/**
 * Apply cache-related environment variable overrides
 */
function applyCacheSettings(config: PerformanceConfig): void {
  config.enableCache = parseEnvBoolean('ENABLE_CACHE', config.enableCache)
  config.cacheTTL = parseEnvInt('CACHE_TTL', config.cacheTTL)
  config.cacheMaxSize = parseEnvInt('CACHE_MAX_SIZE', config.cacheMaxSize)
}

/**
 * Apply circuit breaker environment variable overrides
 */
function applyCircuitBreakerSettings(config: PerformanceConfig): void {
  config.enableCircuitBreaker = parseEnvBoolean(
    'ENABLE_CIRCUIT_BREAKER',
    config.enableCircuitBreaker,
  )
  config.circuitBreakerFailureThreshold = parseEnvInt(
    'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
    config.circuitBreakerFailureThreshold,
  )
  config.circuitBreakerResetTimeout = parseEnvInt(
    'CIRCUIT_BREAKER_RESET_TIMEOUT',
    config.circuitBreakerResetTimeout,
  )
}

/**
 * Apply priority queue environment variable overrides
 */
function applyPriorityQueueSettings(config: PerformanceConfig): void {
  config.enablePriorityQueue = parseEnvBoolean(
    'ENABLE_PRIORITY_QUEUE',
    config.enablePriorityQueue,
  )
  config.priorityQueueSignalThreshold = parseEnvString(
    'PRIORITY_QUEUE_SIGNAL_THRESHOLD',
    config.priorityQueueSignalThreshold,
  )
  config.priorityQueueStakeThreshold = parseEnvString(
    'PRIORITY_QUEUE_STAKE_THRESHOLD',
    config.priorityQueueStakeThreshold,
  )
}

/**
 * Apply network-related environment variable overrides
 */
function applyNetworkSettings(config: PerformanceConfig): void {
  config.enableParallelNetworkQueries = parseEnvBoolean(
    'ENABLE_PARALLEL_NETWORK_QUERIES',
    config.enableParallelNetworkQueries,
  )
  config.networkQueryBatchSize = parseEnvInt(
    'NETWORK_QUERY_BATCH_SIZE',
    config.networkQueryBatchSize,
  )
  config.networkQueryTimeout = parseEnvInt(
    'NETWORK_QUERY_TIMEOUT',
    config.networkQueryTimeout,
  )
}

/**
 * Apply retry-related environment variable overrides
 */
function applyRetrySettings(config: PerformanceConfig): void {
  config.maxRetryAttempts = parseEnvInt(
    'MAX_RETRY_ATTEMPTS',
    config.maxRetryAttempts,
  )
  config.retryDelay = parseEnvInt('RETRY_DELAY', config.retryDelay)
  config.retryBackoffMultiplier = parseEnvFloat(
    'RETRY_BACKOFF_MULTIPLIER',
    config.retryBackoffMultiplier,
  )
}

/**
 * Apply monitoring-related environment variable overrides
 */
function applyMonitoringSettings(config: PerformanceConfig): void {
  config.enableMetrics = parseEnvBoolean('ENABLE_METRICS', config.enableMetrics)
  config.metricsInterval = parseEnvInt(
    'METRICS_INTERVAL',
    config.metricsInterval,
  )
  config.enableDetailedLogging = parseEnvBoolean(
    'ENABLE_DETAILED_LOGGING',
    config.enableDetailedLogging,
  )
}

/**
 * Load performance configuration from environment variables
 */
export function loadPerformanceConfig(): PerformanceConfig {
  const config = { ...DEFAULT_PERFORMANCE_CONFIG }

  applyConcurrencySettings(config)
  applyCacheSettings(config)
  applyCircuitBreakerSettings(config)
  applyPriorityQueueSettings(config)
  applyNetworkSettings(config)
  applyRetrySettings(config)
  applyMonitoringSettings(config)

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
      Math.round(config.allocationConcurrency * 1.5),
    )
    config.deploymentConcurrency = Math.min(
      25,
      Math.round(config.deploymentConcurrency * 1.5),
    )
  } else if (cpuCount <= 2) {
    config.allocationConcurrency = Math.max(
      5,
      Math.round(config.allocationConcurrency * 0.5),
    )
    config.deploymentConcurrency = Math.max(
      5,
      Math.round(config.deploymentConcurrency * 0.5),
    )
  }

  // Adjust cache size based on available memory
  const memoryGB = totalMemory / (1024 * 1024 * 1024)
  if (memoryGB >= 16) {
    config.cacheMaxSize = Math.min(5000, Math.round(config.cacheMaxSize * 2))
  } else if (memoryGB <= 4) {
    config.cacheMaxSize = Math.max(500, Math.round(config.cacheMaxSize * 0.5))
  }

  return config
}
