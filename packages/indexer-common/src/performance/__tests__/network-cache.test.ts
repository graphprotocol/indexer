import { NetworkDataCache } from '../network-cache'
import { createLogger } from '@graphprotocol/common-ts'

describe('NetworkDataCache', () => {
  let cache: NetworkDataCache
  let mockLogger: ReturnType<typeof createLogger>

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as ReturnType<typeof createLogger>

    cache = new NetworkDataCache(mockLogger, {
      ttl: 1000,
      maxSize: 10,
      enableMetrics: true,
      cleanupInterval: 60000,
    })
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', { value: 'test' })
      const result = cache.get<{ value: string }>('key1')
      expect(result).toEqual({ value: 'test' })
    })

    it('should return undefined for non-existent keys', () => {
      const result = cache.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should return undefined for expired entries', async () => {
      cache.set('key1', { value: 'test' })

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const result = cache.get('key1')
      expect(result).toBeUndefined()
    })

    it('should support custom TTL', async () => {
      cache.set('key1', { value: 'test' }, 500)

      // Should still be valid before custom TTL
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(cache.get('key1')).toEqual({ value: 'test' })

      // Should be expired after custom TTL
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(cache.get('key1')).toBeUndefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entries when at capacity', () => {
      // Fill cache to capacity
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i)
      }

      // All entries should exist
      expect(cache.size()).toBe(10)

      // Add one more entry
      cache.set('key10', 10)

      // Size should still be 10 (one evicted)
      expect(cache.size()).toBe(10)

      // First entry should be evicted
      expect(cache.get('key0')).toBeUndefined()

      // Last entry should exist
      expect(cache.get('key10')).toBe(10)
    })

    it('should update LRU order on access', () => {
      // Fill cache
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i)
      }

      // Access key0 to make it most recently used
      cache.get('key0')

      // Add new entry
      cache.set('key10', 10)

      // key1 should be evicted (was LRU after key0 access)
      expect(cache.get('key1')).toBeUndefined()

      // key0 should still exist (was accessed)
      expect(cache.get('key0')).toBe(0)
    })
  })

  describe('getCachedOrFetch', () => {
    it('should return cached value if present', async () => {
      const fetcher = jest.fn().mockResolvedValue('fetched')

      cache.set('key1', 'cached')
      const result = await cache.getCachedOrFetch('key1', fetcher)

      expect(result).toBe('cached')
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('should fetch and cache if not present', async () => {
      const fetcher = jest.fn().mockResolvedValue('fetched')

      const result = await cache.getCachedOrFetch('key1', fetcher)

      expect(result).toBe('fetched')
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(cache.get('key1')).toBe('fetched')
    })

    it('should return stale data on fetch error', async () => {
      cache.set('key1', 'stale')

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const fetcher = jest.fn().mockRejectedValue(new Error('fetch failed'))
      const result = await cache.getCachedOrFetch('key1', fetcher)

      expect(result).toBe('stale')
    })

    it('should throw if no stale data available on fetch error', async () => {
      const fetcher = jest.fn().mockRejectedValue(new Error('fetch failed'))

      await expect(cache.getCachedOrFetch('newkey', fetcher)).rejects.toThrow('fetch failed')
    })
  })

  describe('invalidation', () => {
    it('should invalidate specific key', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.invalidate('key1')

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
    })

    it('should invalidate by pattern', () => {
      cache.set('user:1', 'value1')
      cache.set('user:2', 'value2')
      cache.set('order:1', 'value3')

      const count = cache.invalidatePattern(/^user:/)

      expect(count).toBe(2)
      expect(cache.get('user:1')).toBeUndefined()
      expect(cache.get('user:2')).toBeUndefined()
      expect(cache.get('order:1')).toBe('value3')
    })

    it('should invalidate by prefix', () => {
      cache.set('user:1', 'value1')
      cache.set('user:2', 'value2')
      cache.set('order:1', 'value3')

      const count = cache.invalidatePrefix('user:')

      expect(count).toBe(2)
      expect(cache.get('user:1')).toBeUndefined()
      expect(cache.get('order:1')).toBe('value3')
    })

    it('should clear all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.clear()

      expect(cache.size()).toBe(0)
    })
  })

  describe('metrics', () => {
    it('should track hits and misses', async () => {
      cache.set('key1', 'value1')

      // Hit
      cache.get('key1')
      // Miss
      cache.get('nonexistent')

      const metrics = cache.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)
    })

    it('should calculate hit rate', () => {
      cache.set('key1', 'value1')

      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('miss') // miss

      expect(cache.getHitRate()).toBeCloseTo(0.667, 2)
    })

    it('should track evictions', () => {
      // Fill and overflow
      for (let i = 0; i < 12; i++) {
        cache.set(`key${i}`, i)
      }

      const metrics = cache.getMetrics()
      expect(metrics.evictions).toBe(2)
    })
  })

  describe('warmup', () => {
    it('should warm up cache with multiple entries', async () => {
      const entries = [
        { key: 'key1', fetcher: async () => 'value1' },
        { key: 'key2', fetcher: async () => 'value2' },
        { key: 'key3', fetcher: async () => 'value3' },
      ]

      const result = await cache.warmup(entries, 2)

      expect(result.success).toBe(3)
      expect(result.failed).toBe(0)
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
    })

    it('should handle failures during warmup', async () => {
      const entries = [
        { key: 'key1', fetcher: async () => 'value1' },
        { key: 'key2', fetcher: async () => { throw new Error('failed') } },
      ]

      const result = await cache.warmup(entries, 2)

      expect(result.success).toBe(1)
      expect(result.failed).toBe(1)
    })
  })

  describe('disposal', () => {
    it('should throw when accessing disposed cache', () => {
      cache.dispose()

      expect(() => cache.set('key', 'value')).toThrow('disposed')
      expect(() => cache.get('key')).toThrow('disposed')
    })

    it('should be idempotent', () => {
      cache.dispose()
      cache.dispose() // Should not throw
    })
  })
})
