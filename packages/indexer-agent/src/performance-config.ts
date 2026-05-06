/**
 * Centralized performance configuration for the indexer agent.
 * This is the single source of truth for all performance-related settings.
 * Values can be overridden via environment variables.
 */

import { cpus, totalmem } from 'os'

// ============================================================================
// Default Configuration Constants
// ============================================================================

export const PERFORMANCE_DEFAULTS = {
  // Concurrency settings
  ALLOCATION_CONCURRENCY: 20,
  DEPLOYMENT_CONCURRENCY: 15,
  NETWORK_QUERY_CONCURRENCY: 10,
  BATCH_SIZE: 10,

  // Cache settings
  CACHE_TTL: 30_000, // 30 seconds
  CACHE_MAX_SIZE: 2000,
  CACHE_CLEANUP_INTERVAL: 60_000, // 1 minute

  // Circuit breaker settings
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 60_000, // 1 minute
  CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS: 3,
  CIRCUIT_BREAKER_MONITORING_PERIOD: 300_000, // 5 minutes

  // Priority queue settings
  PRIORITY_QUEUE_SIGNAL_THRESHOLD: '1000000000000000000000', // 1000 GRT
  PRIORITY_QUEUE_STAKE_THRESHOLD: '10000000000000000000000', // 10000 GRT

  // Network settings
  NETWORK_QUERY_BATCH_SIZE: 50,
  NETWORK_QUERY_TIMEOUT: 30_000, // 30 seconds

  // Retry settings
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
  RETRY_BACKOFF_MULTIPLIER: 2,

  // Monitoring settings
  METRICS_INTERVAL: 60_000, // 1 minute
} as const

// ============================================================================
// Environment Variable Parsing Utilities
// ============================================================================

function parseEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value === undefined || value === '') return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

function parseEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value === undefined || value === '') return defaultValue
  const parsed = parseFloat(value)
  return isNaN(parsed) ? defaultValue : parsed
}

function parseEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]
  if (value === undefined || value === '') return defaultValue
  return value.toLowerCase() !== 'false' && value !== '0'
}

function parseEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

// ============================================================================
// Configuration Interface
// ============================================================================

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
  circuitBreakerMonitoringPeriod: number

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

// ============================================================================
// Default Configuration
// ============================================================================

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
  circuitBreakerFailureThreshold: PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  circuitBreakerResetTimeout: PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_RESET_TIMEOUT,
  circuitBreakerHalfOpenMaxAttempts: PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS,
  circuitBreakerMonitoringPeriod: PERFORMANCE_DEFAULTS.CIRCUIT_BREAKER_MONITORING_PERIOD,

  // Priority queue settings
  enablePriorityQueue: true,
  priorityQueueSignalThreshold: PERFORMANCE_DEFAULTS.PRIORITY_QUEUE_SIGNAL_THRESHOLD,
  priorityQueueStakeThreshold: PERFORMANCE_DEFAULTS.PRIORITY_QUEUE_STAKE_THRESHOLD,

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

// ============================================================================
// Configuration Loaders
// ============================================================================

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

function applyCacheSettings(config: PerformanceConfig): void {
  config.enableCache = parseEnvBoolean('ENABLE_CACHE', config.enableCache)
  config.cacheTTL = parseEnvInt('CACHE_TTL', config.cacheTTL)
  config.cacheMaxSize = parseEnvInt('CACHE_MAX_SIZE', config.cacheMaxSize)
  config.cacheCleanupInterval = parseEnvInt(
    'CACHE_CLEANUP_INTERVAL',
    config.cacheCleanupInterval,
  )
}

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
  config.circuitBreakerHalfOpenMaxAttempts = parseEnvInt(
    'CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS',
    config.circuitBreakerHalfOpenMaxAttempts,
  )
}

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

function applyRetrySettings(config: PerformanceConfig): void {
  config.maxRetryAttempts = parseEnvInt('MAX_RETRY_ATTEMPTS', config.maxRetryAttempts)
  config.retryDelay = parseEnvInt('RETRY_DELAY', config.retryDelay)
  config.retryBackoffMultiplier = parseEnvFloat(
    'RETRY_BACKOFF_MULTIPLIER',
    config.retryBackoffMultiplier,
  )
}

function applyMonitoringSettings(config: PerformanceConfig): void {
  config.enableMetrics = parseEnvBoolean('ENABLE_METRICS', config.enableMetrics)
  config.metricsInterval = parseEnvInt('METRICS_INTERVAL', config.metricsInterval)
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

// ============================================================================
// Configuration Validation
// ============================================================================

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

/**
 * Validate performance configuration
 */
export function validatePerformanceConfig(
  config: PerformanceConfig,
): ValidationError[] {
  const errors: ValidationError[] = []

  // Concurrency validation
  if (config.allocationConcurrency < 1 || config.allocationConcurrency > 100) {
    errors.push({
      field: 'allocationConcurrency',
      message: 'Must be between 1 and 100',
      value: config.allocationConcurrency,
    })
  }

  if (config.deploymentConcurrency < 1 || config.deploymentConcurrency > 50) {
    errors.push({
      field: 'deploymentConcurrency',
      message: 'Must be between 1 and 50',
      value: config.deploymentConcurrency,
    })
  }

  if (config.batchSize < 1 || config.batchSize > 100) {
    errors.push({
      field: 'batchSize',
      message: 'Must be between 1 and 100',
      value: config.batchSize,
    })
  }

  // Cache validation
  if (config.cacheTTL < 1000 || config.cacheTTL > 300000) {
    errors.push({
      field: 'cacheTTL',
      message: 'Must be between 1000ms and 300000ms (5 minutes)',
      value: config.cacheTTL,
    })
  }

  if (config.cacheMaxSize < 100 || config.cacheMaxSize > 10000) {
    errors.push({
      field: 'cacheMaxSize',
      message: 'Must be between 100 and 10000',
      value: config.cacheMaxSize,
    })
  }

  // Circuit breaker validation
  if (
    config.circuitBreakerFailureThreshold < 1 ||
    config.circuitBreakerFailureThreshold > 20
  ) {
    errors.push({
      field: 'circuitBreakerFailureThreshold',
      message: 'Must be between 1 and 20',
      value: config.circuitBreakerFailureThreshold,
    })
  }

  // Retry validation
  if (config.maxRetryAttempts < 0 || config.maxRetryAttempts > 10) {
    errors.push({
      field: 'maxRetryAttempts',
      message: 'Must be between 0 and 10',
      value: config.maxRetryAttempts,
    })
  }

  if (config.retryBackoffMultiplier < 1 || config.retryBackoffMultiplier > 5) {
    errors.push({
      field: 'retryBackoffMultiplier',
      message: 'Must be between 1 and 5',
      value: config.retryBackoffMultiplier,
    })
  }

  return errors
}

/**
 * Validate configuration and throw if invalid
 */
export function validatePerformanceConfigOrThrow(config: PerformanceConfig): void {
  const errors = validatePerformanceConfig(config)
  if (errors.length > 0) {
    const messages = errors.map((e) => `${e.field}: ${e.message} (got ${e.value})`)
    throw new Error(`Invalid performance configuration:\n${messages.join('\n')}`)
  }
}

// ============================================================================
// Optimized Configuration
// ============================================================================

/**
 * Get optimized configuration based on system resources.
 * Automatically adjusts settings based on available CPU and memory.
 */
export function getOptimizedConfig(): PerformanceConfig {
  const config = loadPerformanceConfig()

  // Get system resources
  const cpuCount = cpus().length
  const totalMemoryGB = totalmem() / (1024 * 1024 * 1024)

  // Adjust concurrency based on CPU cores
  if (cpuCount >= 8) {
    // High-performance system
    config.allocationConcurrency = Math.min(
      30,
      Math.round(config.allocationConcurrency * 1.5),
    )
    config.deploymentConcurrency = Math.min(
      25,
      Math.round(config.deploymentConcurrency * 1.5),
    )
    config.networkQueryConcurrency = Math.min(
      15,
      Math.round(config.networkQueryConcurrency * 1.5),
    )
  } else if (cpuCount <= 2) {
    // Low-resource system
    config.allocationConcurrency = Math.max(
      5,
      Math.round(config.allocationConcurrency * 0.5),
    )
    config.deploymentConcurrency = Math.max(
      5,
      Math.round(config.deploymentConcurrency * 0.5),
    )
    config.networkQueryConcurrency = Math.max(
      3,
      Math.round(config.networkQueryConcurrency * 0.5),
    )
  }

  // Adjust cache size based on available memory
  if (totalMemoryGB >= 16) {
    // High memory system
    config.cacheMaxSize = Math.min(5000, Math.round(config.cacheMaxSize * 2))
  } else if (totalMemoryGB <= 4) {
    // Low memory system
    config.cacheMaxSize = Math.max(500, Math.round(config.cacheMaxSize * 0.5))
  }

  // Ensure integer values for concurrency
  config.allocationConcurrency = Math.floor(config.allocationConcurrency)
  config.deploymentConcurrency = Math.floor(config.deploymentConcurrency)
  config.networkQueryConcurrency = Math.floor(config.networkQueryConcurrency)
  config.cacheMaxSize = Math.floor(config.cacheMaxSize)

  return config
}

// ============================================================================
// Configuration Summary
// ============================================================================

/**
 * Get a human-readable summary of the configuration
 */
export function getConfigSummary(config: PerformanceConfig): Record<string, unknown> {
  return {
    concurrency: {
      allocation: config.allocationConcurrency,
      deployment: config.deploymentConcurrency,
      networkQuery: config.networkQueryConcurrency,
      batchSize: config.batchSize,
    },
    cache: {
      enabled: config.enableCache,
      ttl: `${config.cacheTTL / 1000}s`,
      maxSize: config.cacheMaxSize,
    },
    circuitBreaker: {
      enabled: config.enableCircuitBreaker,
      failureThreshold: config.circuitBreakerFailureThreshold,
      resetTimeout: `${config.circuitBreakerResetTimeout / 1000}s`,
    },
    priorityQueue: {
      enabled: config.enablePriorityQueue,
    },
    retry: {
      maxAttempts: config.maxRetryAttempts,
      delay: `${config.retryDelay}ms`,
      backoffMultiplier: config.retryBackoffMultiplier,
    },
    monitoring: {
      metrics: config.enableMetrics,
      detailedLogging: config.enableDetailedLogging,
    },
  }
}
