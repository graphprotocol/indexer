import {
  connectContracts,
  connectDatabase,
  createLogger,
  Logger,
  NetworkContracts,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
} from '../models'
import { defineQueryFeeModels, specification as spec } from '../../index'
import { networkIsL1, networkIsL2 } from '../types'
import { fetchIndexingRules, upsertIndexingRule } from '../rules'
import { SubgraphFreshnessChecker, SubgraphIdentifierType } from '../../subgraphs'
import { ActionManager } from '../actions'
import { actionFilterToWhereOptions, ActionStatus, ActionType } from '../../actions'
import { literal, Op, Sequelize } from 'sequelize'
import {
  Allocation,
  AllocationStatus,
  EpochSubgraph,
  indexerError,
  IndexerErrorCode,
  GraphNode,
  NetworkMonitor,
  NetworkSubgraph,
  resolveChainAlias,
  resolveChainId,
  SubgraphDeployment,
  getTestProvider,
} from '@graphprotocol/indexer-common'
import { mockLogger, mockProvider } from '../../__tests__/subgraph.test'
import { BigNumber, ethers, utils } from 'ethers'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

let sequelize: Sequelize
let models: IndexerManagementModels
let ethereum: ethers.providers.BaseProvider
let contracts: NetworkContracts
let graphNode: GraphNode
let networkSubgraph: NetworkSubgraph
let epochSubgraph: EpochSubgraph
let networkMonitor: NetworkMonitor
let logger: Logger

let mockAllocation: Allocation

const setupModels = async () => {
  // Spin up db
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
}

const setupMonitor = async () => {
  mockAllocation = createMockAllocation()
  const statusEndpoint = 'http://127.0.0.1:8030/graphql'
  logger = createLogger({
    name: 'IndexerManagement.Monitor tests',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  ethereum = getTestProvider('sepolia')
  contracts = await connectContracts(ethereum, 5, undefined)

  const subgraphFreshnessChecker = new SubgraphFreshnessChecker(
    'Test Subgraph',
    mockProvider,
    10,
    10,
    mockLogger,
    1,
  )

  networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint:
      'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-sepolia',
    deployment: undefined,
    subgraphFreshnessChecker,
  })

  epochSubgraph = new EpochSubgraph(
    'https://api.thegraph.com/subgraphs/name/graphprotocol/sepolia-epoch-block-oracle',
    subgraphFreshnessChecker,
    logger,
  )
  graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
    [],
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

const createMockAllocation = (): Allocation => {
  const mockDeployment = {
    id: new SubgraphDeploymentID('QmcpeU4pZxzKB9TJ6fzH6PyZi9h8PJ6pG1c4izb9VAakJq'),
    deniedAt: 0,
    stakedTokens: BigNumber.from(50000),
    signalledTokens: BigNumber.from(100000),
    queryFeesAmount: BigNumber.from(0),
  } as SubgraphDeployment
  const mockAllocation = {
    id: toAddress('0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C'),
    status: AllocationStatus.CLOSED,
    subgraphDeployment: mockDeployment,
    indexer: toAddress('0xc61127cdfb5380df4214b0200b9a07c7c49d34f9'),
    allocatedTokens: BigNumber.from(1000),
    createdAtEpoch: 3,
    createdAtBlockHash:
      '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
    closedAtEpoch: 10,
    closedAtEpochStartBlockHash: undefined,
    previousEpochStartBlockHash: undefined,
    closedAtBlockHash:
      '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
    poi: undefined,
    queryFeeRebates: undefined,
    queryFeesCollected: undefined,
  } as Allocation

  return mockAllocation
}
describe('Indexing Rules', () => {
  beforeAll(setupModels)
  test('Insert and fetch indexing rule', async () => {
    const logger = createLogger({
      name: 'Indexing rule helpers tests',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
    const deployment = 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF'
    const indexingRule = {
      identifier: deployment,
      allocationAmount: '5000',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.ALWAYS,
      protocolNetwork: 'sepolia',
    } as Partial<IndexingRuleAttributes>
    const setIndexingRuleResult = await upsertIndexingRule(logger, models, indexingRule)
    expect(setIndexingRuleResult).toHaveProperty(
      'allocationAmount',
      '5000000000000000000000',
    )
    expect(setIndexingRuleResult).toHaveProperty('identifier', deployment)
    expect(setIndexingRuleResult).toHaveProperty(
      'identifierType',
      SubgraphIdentifierType.DEPLOYMENT.toString(),
    )
    expect(setIndexingRuleResult).toHaveProperty(
      'decisionBasis',
      IndexingDecisionBasis.ALWAYS,
    )

    //  When reading directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
    await expect(
      fetchIndexingRules(models, false, 'eip155:11155111'),
    ).resolves.toHaveLength(1)
  })
})

describe('Actions', () => {
  beforeAll(setupModels)

  test('Generate where options', async () => {
    const ActionFilter = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
    }
    expect(actionFilterToWhereOptions(ActionFilter)).toEqual({
      [Op.and]: [{ status: 'failed' }, { type: 'allocate' }],
    })

    const yesterday = literal("NOW() - INTERVAL '1d'")
    const ActionFilter2 = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
      updatedAt: { [Op.gte]: yesterday },
    }

    const where = actionFilterToWhereOptions(ActionFilter2)
    expect(where).toEqual({
      [Op.and]: [
        { status: 'failed' },
        { type: 'allocate' },
        { updatedAt: { [Op.gte]: yesterday } },
      ],
    })

    await expect(
      models.Action.findAll({
        where,
      }),
    ).resolves.toHaveLength(0)
  })

  test('Insert and fetch actions', async () => {
    const action = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
      deploymentID: 'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
      //  When writing directly to the database, `protocolNetwork` must be in the CAIP2-ID format.
      protocolNetwork: 'eip155:11155111',
    }

    await models.Action.upsert(action)

    const filterOptions = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
    }

    const whereOptions = actionFilterToWhereOptions(filterOptions)
    expect(whereOptions).toEqual({
      [Op.and]: [{ status: 'failed' }, { type: 'allocate' }],
    })

    await expect(ActionManager.fetchActions(models, filterOptions)).resolves.toHaveLength(
      1,
    )

    await expect(ActionManager.fetchActions(models, filterOptions)).resolves.toHaveLength(
      1,
    )

    await expect(
      ActionManager.fetchActions(models, {
        status: ActionStatus.FAILED,
        type: ActionType.ALLOCATE,
        updatedAt: { [Op.gte]: literal("NOW() - INTERVAL '1d'") },
      }),
    ).resolves.toHaveLength(1)

    await expect(
      ActionManager.fetchActions(models, {
        status: ActionStatus.FAILED,
        type: ActionType.ALLOCATE,
        updatedAt: { [Op.lte]: literal("NOW() - INTERVAL '1d'") },
      }),
    ).resolves.toHaveLength(0)
  })
})
describe('Types', () => {
  test('Fail to resolve chain id', () => {
    expect(() => resolveChainId('arbitrum')).toThrow(
      'Failed to resolve CAIP2 ID from the provided network alias: arbitrum',
    )
  })

  test('Resolve chain id: `mainnet`', () => {
    expect(resolveChainId('mainnet')).toBe('eip155:1')
  })

  test('Resolve chain id: `11155111`', () => {
    expect(resolveChainId('11155111')).toBe('eip155:11155111')
  })

  test('Resolve chain alias: `eip155:1`', () => {
    expect(resolveChainAlias('eip155:1')).toBe('mainnet')
  })

  test('Fail to Resolve chain alias: `eip155:666`', () => {
    expect(() => resolveChainAlias('eip155:666')).toThrow(
      "Failed to match chain id, 'eip155:666', to a network alias in Caip2ByChainAlias",
    )
  })
})

// This test suite requires a graph-node instance connected to Sepolia, so we're skipping it for now
// Use this test suite locally to test changes to the NetworkMonitor class
describe.skip('Monitor', () => {
  beforeAll(setupMonitor)

  test('Fetch currentEpoch for `sepolia`', async () => {
    await expect(
      networkMonitor.currentEpoch(resolveChainId('sepolia')),
    ).resolves.toHaveProperty('networkID', 'eip155:11155111')
  }, 10000)

  test('Fail to fetch currentEpoch: chain not supported by graph-node', async () => {
    await expect(networkMonitor.currentEpoch('eip155:4200')).rejects.toThrow(
      'Failed to query Epoch Block Oracle Subgraph',
    )
  }, 40000)

  test('Fetch current epoch number of protocol chain', async () => {
    await expect(networkMonitor.currentEpochNumber()).resolves.toBeGreaterThan(1500)
  })

  test('Fetch maxAllocationEpoch', async () => {
    await expect(networkMonitor.maxAllocationEpoch()).resolves.toBeGreaterThan(1)
  })

  test('Fetch network chain current epoch', async () => {
    await expect(networkMonitor.networkCurrentEpoch()).resolves.toHaveProperty(
      'networkID',
      'eip155:11155111',
    )
  })

  test('Resolve POI using force=true', async () => {
    await expect(
      networkMonitor.resolvePOI(mockAllocation, utils.hexlify(Array(32).fill(0)), true),
    ).resolves.toEqual(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  test('Fail to resolve POI', async () => {
    await expect(
      networkMonitor.resolvePOI(mockAllocation, undefined, false),
    ).rejects.toEqual(indexerError(IndexerErrorCode.IE018, `Could not resolve POI`))
  })
})

describe('Network layer detection', () => {
  interface NetworkLayer {
    name: string
    l1: boolean
    l2: boolean
  }

  // Should be true for L1 and false for L2
  const l1Networks: NetworkLayer[] = [
    'mainnet',
    'eip155:1',
    'sepolia',
    'eip155:11155111',
  ].map((name: string) => ({ name, l1: true, l2: false }))

  // Should be false for L1 and true for L2
  const l2Networks: NetworkLayer[] = [
    'arbitrum-one',
    'eip155:42161',
    'arbitrum-goerli',
    'eip155:421613',
  ].map((name: string) => ({ name, l1: false, l2: true }))

  // Those will be false for L1 and L2
  const nonProtocolNetworks: NetworkLayer[] = [
    'fantom',
    'eip155:250',
    'hardhat',
    'eip155:1337',
    'matic',
    'eip155:137',
    'gnosis',
    'eip155:100',
  ].map((name: string) => ({ name, l1: false, l2: false }))

  const testCases = [...l1Networks, ...l2Networks, ...nonProtocolNetworks]

  test.each(testCases)('Can detect network layer [$name]', (network) => {
    expect(networkIsL1(network.name)).toStrictEqual(network.l1)
    expect(networkIsL2(network.name)).toStrictEqual(network.l2)
  })

  const invalidTProtocolNetworkNames = ['invalid-name', 'eip155:9999']

  test.each(invalidTProtocolNetworkNames)(
    'Throws error when protocol network is unknown [%s]',
    (invalidProtocolNetworkName) => {
      expect(() => networkIsL1(invalidProtocolNetworkName)).toThrow()
    },
  )
})
