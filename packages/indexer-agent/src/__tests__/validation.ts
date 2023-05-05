import { validateNetworkOptions, AgentOptions } from '../validation'

const unbalancedOptionsErrorMessage =
  'Indexer-Agent was configured with an unbalanced argument number for these options: [--network-provider, --epoch-subgraph-endpoint, --network-subgraph-endpoint, --network-subgraph-deployment]. Ensure that every option cotains an equal number of arguments.'
const mixedNetworkIdentifiersErrorMessage =
  'Indexer-Agent was configured with mixed network identifiers for these options: [--network-provider, --epoch-subgraph-endpoint, --network-subgraph-endpoint, --network-subgraph-deployment]. Ensure that every network identifier is equally used among options.'
const duplicateNetworkIdentifiersErrorMessage =
  'Indexer-Agent was configured with duplicate network identifiers for these options: [--network-provider, --epoch-subgraph-endpoint, --network-subgraph-endpoint, --network-subgraph-deployment]. Ensure that each network identifier is used at most once.'
const cid = 'QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpBq'

describe('validateNetworkOptions tests', () => {
  it('should parse unidentified network options correctly and reassign them back to their source', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkSubgraphEndpoint: ['https://subgraph1'],
      networkSubgraphDeployment: [cid],
      networkProvider: ['http://provider'],
      epochSubgraphEndpoint: ['http://epoch-subgraph'],
    }
    validateNetworkOptions(options)

    expect(options.networkSubgraphEndpoint).toEqual([
      {
        networkId: null,
        url: new URL('https://subgraph1/'),
      },
    ])
    expect(options.networkSubgraphDeployment).toEqual([
      {
        networkId: null,
        cid,
      },
    ])
    expect(options.networkProvider).toEqual([
      {
        networkId: null,
        url: new URL('http://provider'),
      },
    ])
    expect(options.epochSubgraphEndpoint).toEqual([
      {
        networkId: null,
        url: new URL('http://epoch-subgraph'),
      },
    ])
  })

  it('should parse network options correctly and reassign them back to their source', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkSubgraphEndpoint: ['mainnet:https://subgraph1'],
      networkSubgraphDeployment: [`mainnet:${cid}`],
      networkProvider: ['mainnet:http://provider'],
      epochSubgraphEndpoint: ['mainnet:http://epoch-subgraph'],
    }
    validateNetworkOptions(options)

    expect(options.networkSubgraphEndpoint).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('https://subgraph1/'),
      },
    ])
    expect(options.networkSubgraphDeployment).toEqual([
      {
        networkId: 'eip155:1',
        cid,
      },
    ])
    expect(options.networkProvider).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('http://provider'),
      },
    ])
    expect(options.epochSubgraphEndpoint).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('http://epoch-subgraph'),
      },
    ])
  })

  it('should parse multiple network option pairs correctly', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkSubgraphEndpoint: [
        'mainnet:https://subgraph-1',
        'goerli:https://subgraph-2',
      ],
      networkSubgraphDeployment: [`mainnet:${cid}`, `goerli:${cid}`],
      networkProvider: [
        'mainnet:http://provider-1',
        'goerli:http://provider-2',
      ],
      epochSubgraphEndpoint: [
        'mainnet:http://epoch-subgraph-1',
        'goerli:http://epoch-subgraph-2',
      ],
      defaultProtocolNetwork: 'goerli',
    }
    validateNetworkOptions(options)

    expect(options.networkSubgraphEndpoint).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('https://subgraph-1'),
      },
      {
        networkId: 'eip155:5',
        url: new URL('https://subgraph-2'),
      },
    ])
    expect(options.networkSubgraphDeployment).toEqual([
      {
        networkId: 'eip155:1',
        cid,
      },
      {
        networkId: 'eip155:5',
        cid,
      },
    ])
    expect(options.networkProvider).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('http://provider-1'),
      },
      {
        networkId: 'eip155:5',
        url: new URL('http://provider-2'),
      },
    ])
    expect(options.epochSubgraphEndpoint).toEqual([
      {
        networkId: 'eip155:1',
        url: new URL('http://epoch-subgraph-1'),
      },
      {
        networkId: 'eip155:5',
        url: new URL('http://epoch-subgraph-2'),
      },
    ])
  })

  it('should throw an error if neither networkSubgraphEndpoint nor networkSubgraphDeployment is provided', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkProvider: ['http://provider'],
      epochSubgraphEndpoint: ['http://epoch-subgraph'],
      networkSubgraphEndpoint: undefined,
      networkSubgraphDeployment: undefined,
    }
    expect(() => validateNetworkOptions(options)).toThrowError(
      'At least one of --network-subgraph-endpoint and --network-subgraph-deployment must be provided',
    )
  })

  it('should throw an error if the length of network options is not consistent', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkSubgraphEndpoint: [
        'https://network-subgraph1',
        'https://network-subgraph2',
      ],
      networkSubgraphDeployment: [cid],
      networkProvider: ['http://provider'],
      epochSubgraphEndpoint: ['http://epoch-subgraph'],
    }
    expect(() => validateNetworkOptions(options)).toThrowError(
      unbalancedOptionsErrorMessage,
    )
  })

  describe('should throw an error if the network identifiers are not balanced', () => {
    it('by omission', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: ['https://network-subgraph'],
        networkSubgraphDeployment: [`mainnet:${cid}`],
        networkProvider: ['mainnet:http://provider'],
        epochSubgraphEndpoint: ['mainnet:http://epoch-subgraph'],
      }
      expect(() => validateNetworkOptions(options)).toThrowError(
        mixedNetworkIdentifiersErrorMessage,
      )
    })

    it('by difference', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: ['goerli:https://network-subgraph'],
        networkSubgraphDeployment: [`mainnet:${cid}`],
        networkProvider: ['mainnet:http://provider'],
        epochSubgraphEndpoint: ['mainnet:http://epoch-subgraph'],
      }
      expect(() => validateNetworkOptions(options)).toThrowError(
        mixedNetworkIdentifiersErrorMessage,
      )
    })

    it('by duplication', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: [
          'mainnet:https://network-subgraph-1',
          'mainnet:https://network-subgraph-2',
        ],
        networkSubgraphDeployment: [
          `mainnet:${cid}`,
          `mainnet:${cid.replace('a', 'b')}`,
        ],
        networkProvider: [
          'mainnet:http://provider-1',
          'mainnet:http://provider-2',
        ],
        epochSubgraphEndpoint: [
          'mainnet:http://epoch-subgraph-1',
          'mainnet:http://epoch-subgraph-2',
        ],
      }
      expect(() => validateNetworkOptions(options)).toThrowError(
        duplicateNetworkIdentifiersErrorMessage,
      )
    })
  })

  it('should throw an error if identified options are mixed with unidentified ones', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Mock this value's type for this test
    const options: AgentOptions = {
      networkSubgraphEndpoint: [
        'mainnet:https://subgraph-1',
        'https://subgraph-2',
      ],
      networkSubgraphDeployment: [`mainnet:${cid}`, `goerli:${cid}`],
      networkProvider: ['mainnet:http://provider-1', 'http://provider-2'],
      epochSubgraphEndpoint: [
        'mainnet:http://epoch-subgraph-1',
        'http://epoch-subgraph-2',
      ],
    }
    expect(() => validateNetworkOptions(options)).toThrow(
      mixedNetworkIdentifiersErrorMessage,
    )
  })

  describe('defaultProtocolNetwork parameter tests', () => {
    it('should be valid if propperly defined and network options are tagged', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: ['mainnet:https://subgraph1'],
        networkSubgraphDeployment: [`mainnet:${cid}`],
        networkProvider: ['mainnet:http://provider'],
        epochSubgraphEndpoint: ['mainnet:http://epoch-subgraph'],
        defaultProtocolNetwork: 'mainnet',
      }
      validateNetworkOptions(options)
    })

    it('should be valid if propperly defined and network options are untagged', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: ['https://subgraph1'],
        networkSubgraphDeployment: [cid],
        networkProvider: ['http://provider'],
        epochSubgraphEndpoint: ['http://epoch-subgraph'],
        defaultProtocolNetwork: 'mainnet',
      }
      validateNetworkOptions(options)
    })

    it('should fail if defined to a different network identifier than used by other options', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: Mock this value's type for this test
      const options: AgentOptions = {
        networkSubgraphEndpoint: ['mainnet:https://subgraph1'],
        networkSubgraphDeployment: [`mainnet:${cid}`],
        networkProvider: ['mainnet:http://provider'],
        epochSubgraphEndpoint: ['mainnet:http://epoch-subgraph'],
        defaultProtocolNetwork: 'goerli',
      }
      expect(() => validateNetworkOptions(options)).toThrowError(
        'Indexer-Agent was configured with a --default-protocol-network parameter different ' +
          'from the network identifiers used in the --network-provider parameter.',
      )
    })
  })
})
