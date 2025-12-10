import { Logger } from '@graphprotocol/common-ts'

export interface CacheOptions {
  ttl?: number // Time to live in milliseconds
  maxSize?: number // Maximum number of entries
  enableMetrics?: boolean
  cleanupInterval?: number // Cleanup interval in milliseconds
}

interface CachedEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
  hits: number
}

interface CacheMetrics {
  hits: number
  misses: number
  evictions: number
  size: number
  staleHits: number
}

// Default configuration constants
const CACHE_DEFAULTS = {
  TTL: 30_000, // 30 seconds
  MAX_SIZE: 1000,
  CLEANUP_INTERVAL: 60_000, // 1 minute
} as const

/**
 * High-performance caching layer for network data with TTL and LRU eviction.
 * Uses Map's insertion order for O(1) LRU operations.
 *
 * Thread-safety: This implementation is safe for single-threaded Node.js
 * async operations as JavaScript is single-threaded and Map operations
 * are atomic within a single tick.
 */
export class NetworkDataCache {
  private cache = new Map<string, CachedEntry<unknown>>()
  private cleanupInterval?: NodeJS.Timeout
  private readonly ttl: number
  private readonly maxSize: number
  private readonly enableMetrics: boolean
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    staleHits: 0,
  }
  private logger: Logger
  private disposed = false

  constructor(logger: Logger, options: CacheOptions = {}) {
    this.logger = logger.child({ component: 'NetworkDataCache' })
    this.ttl = options.ttl ?? CACHE_DEFAULTS.TTL
    this.maxSize = options.maxSize ?? CACHE_DEFAULTS.MAX_SIZE
    this.enableMetrics = options.enableMetrics ?? false

    const cleanupIntervalMs = options.cleanupInterval ?? CACHE_DEFAULTS.CLEANUP_INTERVAL

    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs)

    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }

    this.logger.debug('NetworkDataCache initialized', {
      ttl: this.ttl,
      maxSize: this.maxSize,
      cleanupInterval: cleanupIntervalMs,
    })
  }

  /**
   * Get cached data or fetch if not present/expired.
   * Implements stale-while-revalidate pattern for resilience.
   */
  async getCachedOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    customTtl?: number,
  ): Promise<T> {
    this.ensureNotDisposed()

    const effectiveTtl = customTtl ?? this.ttl
    const cached = this.cache.get(key)
    const now = Date.now()

    if (cached && now < cached.expiresAt) {
      // Cache hit - move to end for LRU (delete and re-add)
      this.cache.delete(key)
      cached.hits++
      this.cache.set(key, cached)

      if (this.enableMetrics) {
        this.metrics.hits++
        this.logger.trace('Cache hit', { key, hits: cached.hits })
      }
      return cached.data as T
    }

    // Cache miss or expired
    if (this.enableMetrics) {
      this.metrics.misses++
      this.logger.trace('Cache miss', { key, reason: cached ? 'expired' : 'not_found' })
    }

    try {
      const data = await fetcher()
      this.set(key, data, effectiveTtl)
      return data
    } catch (error) {
      // On error, return stale data if available (stale-while-revalidate)
      if (cached) {
        if (this.enableMetrics) {
          this.metrics.staleHits++
        }
        this.logger.warn('Fetcher failed, returning stale data', {
          key,
          error: error instanceof Error ? error.message : String(error),
          staleAge: now - cached.timestamp,
        })
        return cached.data as T
      }
      throw error
    }
  }

  /**
   * Set a value in the cache with LRU eviction
   */
  set<T>(key: string, data: T, customTtl?: number): void {
    this.ensureNotDisposed()

    const effectiveTtl = customTtl ?? this.ttl
    const now = Date.now()

    // Remove existing entry if present (for LRU ordering)
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else {
      // Evict LRU entries if at capacity
      while (this.cache.size >= this.maxSize) {
        this.evictLRU()
      }
    }

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + effectiveTtl,
      hits: 0,
    })

    this.metrics.size = this.cache.size
  }

  /**
   * Get a value from cache without fetching
   */
  get<T>(key: string): T | undefined {
    this.ensureNotDisposed()

    const cached = this.cache.get(key)
    const now = Date.now()

    if (cached && now < cached.expiresAt) {
      // Move to end for LRU
      this.cache.delete(key)
      cached.hits++
      this.cache.set(key, cached)

      if (this.enableMetrics) {
        this.metrics.hits++
      }
      return cached.data as T
    }

    if (this.enableMetrics && cached) {
      this.metrics.misses++
    }
    return undefined
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const cached = this.cache.get(key)
    return cached !== undefined && Date.now() < cached.expiresAt
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): boolean {
    const deleted = this.cache.delete(key)
    if (deleted) {
      this.metrics.size = this.cache.size
      this.logger.trace('Cache entry invalidated', { key })
    }
    return deleted
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
        count++
      }
    }

    if (count > 0) {
      this.metrics.size = this.cache.size
      this.logger.debug('Invalidated cache entries by pattern', {
        pattern: pattern.toString(),
        count,
      })
    }

    return count
  }

  /**
   * Invalidate entries with a specific prefix
   */
  invalidatePrefix(prefix: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
      }
    }

    if (count > 0) {
      this.metrics.size = this.cache.size
      this.logger.debug('Invalidated cache entries by prefix', { prefix, count })
    }

    return count
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    this.metrics.size = 0
    this.logger.info('Cache cleared', { entriesCleared: size })
  }

  /**
   * Get cache metrics
   */
  getMetrics(): Readonly<CacheMetrics> {
    return { ...this.metrics }
  }

  /**
   * Get cache hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.metrics.hits + this.metrics.misses
    return total === 0 ? 0 : this.metrics.hits / total
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size
  }

  /**
   * Get all cache keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Evict least recently used entry (first item in Map)
   */
  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      this.cache.delete(firstKey)
      if (this.enableMetrics) {
        this.metrics.evictions++
      }
      this.logger.trace('Evicted LRU entry', { key: firstKey })
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    if (this.disposed) return

    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.metrics.size = this.cache.size
      this.logger.trace('Cleaned expired cache entries', { count: cleaned })
    }
  }

  /**
   * Warm up cache with multiple entries concurrently
   */
  async warmup<T>(
    entries: Array<{ key: string; fetcher: () => Promise<T> }>,
    concurrency = 10,
  ): Promise<{ success: number; failed: number }> {
    this.ensureNotDisposed()

    let success = 0
    let failed = 0

    // Process in batches for controlled concurrency
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency)
      const results = await Promise.allSettled(
        batch.map(({ key, fetcher }) =>
          this.getCachedOrFetch(key, fetcher).then(() => true),
        ),
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          success++
        } else {
          failed++
          this.logger.warn('Failed to warm cache entry', {
            error: result.reason,
          })
        }
      }
    }

    this.logger.info('Cache warmed up', { total: entries.length, success, failed })
    return { success, failed }
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: this.cache.size,
      staleHits: 0,
    }
  }

  /**
   * Ensure cache is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('NetworkDataCache has been disposed')
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
    this.logger.debug('NetworkDataCache disposed')
  }

  /**
   * Support for async disposal (Symbol.asyncDispose)
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose()
  }
}
