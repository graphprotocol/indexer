import pReduce from 'p-reduce'
import zip from 'lodash.zip'

import { Network, Operator } from '@graphprotocol/indexer-common'

export type NetworkMapped<T> = Record<string, T>

// Wrapper type for performing calls over multiple Network and Operator objects.
// All public-facing methods should return a `NetworkMapped<T>` or `void`.
export class MultiNetworks {
  networks: Network[]
  operators: Operator[]
  constructor(networks: Network[], operators: Operator[]) {
    // Make sure both networks and operators have matching networkIdentifiers
    if (!this.checkInputs(networks, operators)) {
      throw new Error(
        "Malconfigured Multi-Network input: Networks and Operators don't match",
      )
    }
    this.networks = networks
    this.operators = operators
  }

  private checkInputs(networks: Network[], operators: Operator[]): boolean {
    return (
      networks.length === operators.length &&
      networks.every(
        (network, index) =>
          network.specification.networkIdentifier ===
          operators[index].specification.networkIdentifier,
      )
    )
  }

  async mapNetworks<T>(
    func: (n: Network) => Promise<T>,
  ): Promise<NetworkMapped<T>> {
    return pReduce(
      this.networks,
      async (acc, network) => {
        const result = await func(network)
        acc[network.specification.networkIdentifier] = result
        return acc
      },
      {} as NetworkMapped<T>,
    )
  }

  async mapOperators<T>(
    func: (o: Operator) => Promise<T>,
  ): Promise<NetworkMapped<T>> {
    return pReduce(
      this.operators,
      async (acc, operator) => {
        const result = await func(operator)
        acc[operator.specification.networkIdentifier] = result
        return acc
      },
      {} as NetworkMapped<T>,
    )
  }

  async mapNetworkAndOperatorPairs<T>(
    func: (n: Network, o: Operator) => Promise<T>,
  ): Promise<NetworkMapped<T>> {
    return pReduce(
      zip(this.networks, this.operators),
      // Note on undefineds: `lodash.zip` can return `undefined` if array lengths are
      // uneven, but we have validated that this won't happen.
      async (acc, pair: [Network | undefined, Operator | undefined]) => {
        const [network, operator] = pair
        const result = await func(network!, operator!)
        acc[operator!.specification.networkIdentifier] = result
        return acc
      },
      {} as NetworkMapped<T>,
    )
  }

  zipNetworkMaps<T, U>(
    a: NetworkMapped<T>,
    b: NetworkMapped<U>,
  ): NetworkMapped<[T, U]> {
    const result = {} as NetworkMapped<[T, U]>
    for (const key in a) {
      result[key] = [a[key], b[key]]
    }
    return result
  }

  async mapNetworkMapped<T, U>(
    nmap: NetworkMapped<T>,
    func: (n: Network, o: Operator, value: T) => Promise<U>,
  ): Promise<NetworkMapped<U>> {
    return pReduce(
      Object.entries(nmap),
      async (acc, [networkIdentifier, value]: [string, T]) => {
        // Get the Network and Operator objects for this network identifier
        const index = this.networks.findIndex(
          (n: Network) =>
            n.specification.networkIdentifier === networkIdentifier,
        )
        const network = this.networks[index]
        const operator = this.operators[index]

        acc[networkIdentifier] = await func(network, operator, value)
        return acc
      },
      {} as NetworkMapped<U>,
    )
  }
}
