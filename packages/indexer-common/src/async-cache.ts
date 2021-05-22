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

    // This can throw, even though we do not
    // await the promise. Because of this,
    // we need to construct p outside of
    // attempt. If p was constructed in the attempt
    // there is a subtle timing bug.
    // 1. The 'attempt' promise starts to be constructed.
    // 2. Within the attempt promise, calling this._fn(k) fails
    //    before the await. This means that the catch is called
    //    synchronously.
    // 3. Within the catch, we delete this._attempts[k].
    // 4. 'attempt' is constructed successfully as a failed promise.
    // 5. Finally, this._attempts is set - but in a perpetually
    //    failed state.
    // By constructing the promise here, if the construction
    // fails then it never ends up in _attempts and this throws
    // right away.
    const p = this._fn(k)

    // This shares concurrent attempts, but still retries on failure.
    const attempt = (async () => {
      try {
        return await p
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
