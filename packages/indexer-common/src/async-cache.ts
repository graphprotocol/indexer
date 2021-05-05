// Cache which avoids concurrently getting the same thing more than once.
export class AsyncCache<K, V> {
  private readonly _attempts: Map<K, Promise<V>> = new Map()
  private readonly _fn: (k: K) => Promise<V>

  constructor(fn: (k: K) => Promise<V>) {
    this._fn = fn
  }

  get(k: K): Promise<V> {
    const cached = this._attempts.get(k)
    if (cached) {
      return cached
    }

    // This shares concurrent attempts, but still retries on failure.
    const attempt = (async () => {
      try {
        return await this._fn(k)
      } catch (e) {
        // By removing the cached attempt we ensure this is retried
        this._attempts.delete(k)
        throw e
      }
    })()
    this._attempts.set(k, attempt)
    return attempt
  }
}
