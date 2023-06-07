import pReduce from 'p-reduce'
import isEqual from 'lodash.isequal'
import xor from 'lodash.xor'

// A mapping of different values of type T keyed by their network identifiers
export type NetworkMapped<T> = Record<string, T>

// Function to extract the network identifier from a value of type T
type NetworkIdentity<T> = (element: T) => string

// Wrapper type for performing calls over multiple values of any type, most notably
// Network and Operator instances.
// All public-facing methods should return a `NetworkMapped<T>` or `void`.
export class MultiNetworks<T> {
  inner: NetworkMapped<T>
  constructor(elements: T[], networkIdentity: NetworkIdentity<T>) {
    function reducer(accumulator: NetworkMapped<T>, current: T): NetworkMapped<T> {
      const key = networkIdentity(current)
      if (key in accumulator) {
        throw new Error(
          `Duplicate network identifier found while mapping value's network: ${key}`,
        )
      }
      // TODO: parse and validate network identifiers to standardize them
      accumulator[key] = current
      return accumulator
    }
    this.inner = elements.reduce(reducer, {})
  }

  private checkEqualKeys<T, U>(a: NetworkMapped<T>, b: NetworkMapped<U>) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (!isEqual(aKeys, bKeys)) {
      const differentKeys = xor(aKeys, bKeys)
      throw new Error(`Network Mapped objects have different keys: ${differentKeys}`)
    }
  }

  async map<U>(func: (value: T) => Promise<U>): Promise<NetworkMapped<U>> {
    const entries: [string, T][] = Object.entries(this.inner)
    return pReduce(
      entries,
      async (acc, pair) => {
        const [networkIdentifier, element]: [string, T] = pair
        const result = await func(element)
        acc[networkIdentifier] = result
        return acc
      },
      {} as NetworkMapped<U>,
    )
  }

  zip<U, V>(a: NetworkMapped<U>, b: NetworkMapped<V>): NetworkMapped<[U, V]> {
    this.checkEqualKeys(a, b)
    const result = {} as NetworkMapped<[U, V]>
    for (const key in a) {
      result[key] = [a[key], b[key]]
    }
    return result
  }

  zip4<U, V, W, Y>(
    a: NetworkMapped<U>,
    b: NetworkMapped<V>,
    c: NetworkMapped<W>,
    d: NetworkMapped<Y>,
  ): NetworkMapped<[U, V, W, Y]> {
    this.checkEqualKeys(a, b)
    const result = {} as NetworkMapped<[U, V, W, Y]>
    for (const key in a) {
      result[key] = [a[key], b[key], c[key], d[key]]
    }
    return result
  }

  async mapNetworkMapped<U, V>(
    nmap: NetworkMapped<U>,
    func: (inner: T, value: U) => Promise<V>,
  ): Promise<NetworkMapped<V>> {
    return pReduce(
      Object.entries(nmap),
      async (acc, [networkIdentifier, value]: [string, U]) => {
        const inner = this.inner[networkIdentifier]
        if (!inner) {
          throw new Error(`Network identifier not found: ${networkIdentifier}`)
        }
        acc[networkIdentifier] = await func(inner, value)
        return acc
      },
      {} as NetworkMapped<V>,
    )
  }
}
