import { Logger } from '@graphprotocol/common-ts'

export interface CacheOptions {
  ttl?: number // Time to live in milliseconds
  maxSize?: number // Maximum number of entries
  enableMetrics?: boolean
}

interface CachedEntry<T> {
  data: T
  timestamp: number
  hits: number
}

interface CacheMetrics {
  hits: number
  misses: number
  evictions: number
  size: number
}

/**
 * High-performance caching layer for network data with TTL and LRU eviction
 */
export class NetworkDataCache {
  private cache = new Map<string, CachedEntry<unknown>>()
  private readonly ttl: number
  private readonly maxSize: number
  private readonly enableMetrics: boolean
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
  }
  private accessOrder: string[] = []
  private logger: Logger

  constructor(logger: Logger, options: CacheOptions = {}) {
    this.logger = logger.child({ component: 'NetworkDataCache' })
    this.ttl = options.ttl || 30000 // Default 30 seconds
    this.maxSize = options.maxSize || 1000
    this.enableMetrics = options.enableMetrics || false

    // Periodic cleanup of expired entries
    setInterval(() => this.cleanup(), this.ttl)
  }

  /**
   * Get cached data or fetch if not present/expired
   */
  async getCachedOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    customTtl?: number,
  ): Promise<T> {
    const cached = this.cache.get(key)
    const effectiveTtl = customTtl || this.ttl

    if (cached && Date.now() - cached.timestamp < effectiveTtl) {
      // Cache hit
      cached.hits++
      this.updateAccessOrder(key)
      if (this.enableMetrics) {
        this.metrics.hits++
        this.logger.trace('Cache hit', { key, hits: cached.hits })
      }
      return cached.data as T
    }

    // Cache miss
    if (this.enableMetrics) {
      this.metrics.misses++
      this.logger.trace('Cache miss', { key })
    }

    try {
      const data = await fetcher()
      this.set(key, data)
      return data
    } catch (error) {
      // On error, return stale data if available
      if (cached) {
        this.logger.warn('Fetcher failed, returning stale data', { key, error })
        return cached.data as T
      }
      throw error
    }
  }

  /**
   * Set a value in the cache
   */
  set<T>(key: string, data: T): void {
    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    })

    this.updateAccessOrder(key)
    this.metrics.size = this.cache.size
  }

  /**
   * Get a value from cache without fetching
   */
  get<T>(key: string): T | undefined {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      cached.hits++
      this.updateAccessOrder(key)
      if (this.enableMetrics) this.metrics.hits++
      return cached.data as T
    }
    if (this.enableMetrics) this.metrics.misses++
    return undefined
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    const deleted = this.cache.delete(key)
    if (deleted) {
      const index = this.accessOrder.indexOf(key)
      if (index > -1) {
        this.accessOrder.splice(index, 1)
      }
      this.metrics.size = this.cache.size
      this.logger.trace('Cache entry invalidated', { key })
    }
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): void {
    let count = 0
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.invalidate(key)
        count++
      }
    }
    if (count > 0) {
      this.logger.debug('Invalidated cache entries by pattern', { pattern: pattern.toString(), count })
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    this.accessOrder = []
    this.metrics.size = 0
    this.logger.info('Cache cleared', { entriesCleared: size })
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.metrics.hits + this.metrics.misses
    return total === 0 ? 0 : this.metrics.hits / total
  }

  /**
   * Update LRU access order
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(key)
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()!
      this.cache.delete(lruKey)
      if (this.enableMetrics) {
        this.metrics.evictions++
      }
      this.logger.trace('Evicted LRU entry', { key: lruKey })
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.invalidate(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.logger.trace('Cleaned expired cache entries', { count: cleaned })
    }
  }

  /**
   * Warm up cache with multiple entries
   */
  async warmup<T>(
    entries: Array<{ key: string; fetcher: () => Promise<T> }>,
    concurrency: number = 10,
  ): Promise<void> {
    const chunks: Array<Array<{ key: string; fetcher: () => Promise<T> }>> = []
    for (let i = 0; i < entries.length; i += concurrency) {
      chunks.push(entries.slice(i, i + concurrency))
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(({ key, fetcher }) =>
          this.getCachedOrFetch(key, fetcher).catch(error =>
            this.logger.warn('Failed to warm cache entry', { key, error }),
          ),
        ),
      )
    }

    this.logger.info('Cache warmed up', { entries: entries.length })
  }
}
