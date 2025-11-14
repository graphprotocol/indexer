import { createLogger, Logger } from '@graphprotocol/common-ts'
import { NetworkMonitor } from '../monitor'
import { getTestProvider } from '../../utils'
import { resolveChainId } from '../../indexer-management'
import { GraphNode } from '../../graph-node'
import { SubgraphClient } from '../../subgraph-client'
import { SubgraphFreshnessChecker } from '../../subgraphs'
import { mockLogger, mockProvider } from '../../__tests__/subgraph.test'
import { specification as spec } from '../../index'
import {
  connectGraphHorizon,
  connectSubgraphService,
} from '@graphprotocol/toolshed/deployments'
import { Provider } from 'ethers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

describe('Horizon readiness', () => {
  let logger: Logger
  let ethereum: Provider
  let graphNode: GraphNode
  let networkSubgraph: SubgraphClient
  let epochSubgraph: SubgraphClient
  let networkMonitor: NetworkMonitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockHorizonStaking: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contracts: any

  const setupMonitor = async () => {
    logger = createLogger({
      name: 'Horizon readiness tests',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
    ethereum = getTestProvider('sepolia')

    mockHorizonStaking = {
      getMaxThawingPeriod: jest.fn(),
      connect: jest.fn(),
      waitForDeployment: jest.fn(),
      interface: {},
      queryFilter: jest.fn(),
    }

    const horizonContracts = {
      ...connectGraphHorizon(5, ethereum),
      HorizonStaking: mockHorizonStaking,
    }
    contracts = {
      ...horizonContracts,
      ...connectSubgraphService(5, ethereum),
    }

    const subgraphFreshnessChecker = new SubgraphFreshnessChecker(
      'Test Subgraph',
      mockProvider,
      10,
      10,
      mockLogger,
      1,
    )

    networkSubgraph = await SubgraphClient.create({
      name: 'NetworkSubgraph',
      logger,
      endpoint: 'http://test-endpoint.xyz',
      deployment: undefined,
      subgraphFreshnessChecker,
    })

    epochSubgraph = await SubgraphClient.create({
      name: 'EpochSubgraph',
      logger,
      endpoint: 'http://test-endpoint.xyz',
      subgraphFreshnessChecker,
    })

    graphNode = new GraphNode(
      logger,
      'http://test-admin-endpoint.xyz',
      'https://test-query-endpoint.xyz',
      'http://test-status-endpoint.xyz',
      'https://test-ipfs-endpoint.xyz',
    )

    const indexerOptions = spec.IndexerOptions.parse({
      address: '0xc61127cdfb5380df4214b0200b9a07c7c49d34f9',
      mnemonic:
        'word ivory whale diesel slab pelican voyage oxygen chat find tobacco sport',
      url: 'http://test-url.xyz',
    })

    networkMonitor = new NetworkMonitor(
      resolveChainId('sepolia'),
      contracts,
      indexerOptions,
      logger,
      graphNode,
      networkSubgraph,
      ethereum,
      epochSubgraph,
    )
  }

  beforeEach(setupMonitor)

  describe('monitorIsHorizon', () => {
    beforeEach(() => {
      mockHorizonStaking.getMaxThawingPeriod.mockResolvedValue(0)
    })

    test('should return false when getMaxThawingPeriod returns 0', async () => {
      const isHorizon = await networkMonitor.monitorIsHorizon(logger, {
        ...contracts,
        HorizonStaking: mockHorizonStaking,
      })
      const value = await isHorizon.value()
      expect(value).toBe(false)
    })

    test('should return true when getMaxThawingPeriod returns > 0', async () => {
      mockHorizonStaking.getMaxThawingPeriod.mockResolvedValue(1000)

      const isHorizon = await networkMonitor.monitorIsHorizon(logger, {
        ...contracts,
        HorizonStaking: mockHorizonStaking,
      })

      const value = await isHorizon.value()
      console.log('Final value:', value)
      expect(value).toBe(true)
    })

    test('should handle errors and maintain previous state', async () => {
      mockHorizonStaking.getMaxThawingPeriod.mockRejectedValue(
        new Error('Contract error'),
      )

      const isHorizon = await networkMonitor.monitorIsHorizon(logger, {
        ...contracts,
        HorizonStaking: mockHorizonStaking,
      })

      const value = await isHorizon.value()
      expect(value).toBe(false)
    })
  })
})
