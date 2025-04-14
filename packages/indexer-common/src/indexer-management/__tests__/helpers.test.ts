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
  indexerError,
  IndexerErrorCode,
  GraphNode,
  NetworkMonitor,
  SubgraphClient,
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
let networkSubgraph: SubgraphClient
let epochSubgraph: SubgraphClient
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

  const INDEXER_TEST_API_KEY: string = process.env['INDEXER_TEST_API_KEY'] || ''

  networkSubgraph = await SubgraphClient.create({
    name: 'NetworkSubgraph',
    logger,
    endpoint: `https://gateway-arbitrum.network.thegraph.com/api/${INDEXER_TEST_API_KEY}/subgraphs/id/3xQHhMudr1oh69ut36G2mbzpYmYxwqCeU6wwqyCDCnqV`,
    deployment: undefined,
    subgraphFreshnessChecker,
  })

  epochSubgraph = await SubgraphClient.create({
    name: 'EpochSubgraph',
    logger,
    endpoint: `https://gateway-arbitrum.network.thegraph.com/api/${INDEXER_TEST_API_KEY}/subgraphs/id/BhnsdeZihU4SuokxZMLF4FQBVJ3jgtZf6v51gHvz3bSS`,
    subgraphFreshnessChecker,
  })

  graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
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

export const createMockAllocation = (): Allocation => {
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
      protocolNetwork: 'arbitrum-sepolia',
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
      fetchIndexingRules(models, false, 'eip155:421614'),
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
      protocolNetwork: 'eip155:421614',
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

    await expect(
      ActionManager.fetchActions(models, null, filterOptions),
    ).resolves.toHaveLength(1)

    await expect(
      ActionManager.fetchActions(models, null, filterOptions),
    ).resolves.toHaveLength(1)

    await expect(
      ActionManager.fetchActions(models, null, {
        status: ActionStatus.FAILED,
        type: ActionType.ALLOCATE,
        updatedAt: { [Op.gte]: literal("NOW() - INTERVAL '1d'") },
      }),
    ).resolves.toHaveLength(1)

    await expect(
      ActionManager.fetchActions(models, null, {
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
describe.skip('Monitor: local', () => {
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
      'eip155:421614',
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

// Skipped until we can run on a local-network based stack.
describe.skip('Monitor: CI', () => {
  beforeAll(setupMonitor)

  test('Fetch subgraphs', async () => {
    const subgraphs = await networkMonitor.subgraphs([
      'HvYz9828kSW9vhDef42agWaJVEifgYh8qQ1vUTy1aiYB',
      'BgGaFXhu17ikYBjezuyYXGgaDtP6nVhnk3FmEw7rVDPH',
      'Dtopx26mi8QZUz8TQGeEk8ranuVGUnmPgi7qAZbGtsFi',
      'DRc8dd1ugk7To99Q51UG3PrJppneR3XtbWu5xkQFCqh7',
      '7gEARKTwgN8xbTnaDBmfSuxi2s5dWRpqGEKjc7gx1znW',
      '5bSJRNJFjMJy87v2uwuo82GQyyGAps2u96x2UQyN8Uhc',
      'JBZfGX5pWpya4HJHkY54EcjQe1tJhNfszDTbjZGjgGjV',
      'Gj5g62GNwRdAjRcGj9qh7M3iwR5SULVYDqAk8wsi1XJq',
      '3XKjubSDj6pzn8BasduK6kJGNkAVg3fWUuCBzP5jzCCM',
      '66CJq5efooGv6Zu2tE8t2xWiGF1cMZqLQxVLBF3SquKR',
      'A5iZuVkBbxU2GwJcQKN35JvUSaUcLJeygwwnpukhPvjG',
      'CdJLdxVQPigWi3LJoDdwf8r6mXBL8nzn1kdVWp2HeLBN',
      '6qMkvRupvTRuHbYHaSRgP6ebjqM1ELjCHrkQoH9eJQcA',
      'ELxt8ANmxY7i1EXEnP3tv8tYi8S5rTwt9WDP4yYJkwyR',
      'ASB13Eew3Td483LX8A5G6wTiApvySgvYLqrFM3yJiG6E',
      '5etifdh5PjGTAx4hwS2baYDEwZMzvPDXFXmAT5kVKk4E',
      'HzfmvtAPCTmrmiupvWYUdesW21UeDZXgN3oVdTGhV57J',
      '2a9q1MCYJw5HHc9n87uUr9dvRcQd16ghd55cZRGSzGa2',
      'EiJPdVWJYtZKdtQjwDdfMahHc5aNncQMXVK2JZACFuFV',
      '8ScER3UC5cP12BDpxX6a5WyW41LcUkCZtbXfF31zdrXS',
      'GLRGaAVXu3qHs3h6GKmEV6kpVFiN7VS2fwcfPvBJPUbq',
      'CBirSH123kAM7eEVJ1WRYUm8RDwnKPn96zakbDPLoKjV',
      'BzV6inHQyfYh3Gtd8WWSJ3YY5ghmAHd7aT3Eu84ZfHTK',
      'EgPkp3cJm3J3wHdkJBN9kbgW5e3ZTMTnR6aKs81mCp39',
      '8vZCBf6XcYDGS6XxvhNbenT71qwn6SYwti6KwdoKNzn6',
      'HfWJgc9Xg2APHKTqCi3VnvrtbPHPwXZEvdmShaFSdyCL',
      'Ayqu513Ky67HJP5uednpdRwPSTXj1vftCqF7t3dZCrZ2',
      '7a4xK25hdSygHSjiZfhgcqJLmP28XwYUJLaK77w55h8V',
      'ANCYpT6k2rBVC72cQH4M9w3nPhMGxNDvibFQjjDqAbaY',
      'Bo8SSPTVT6S9aUSMfMMtQxeLvWHpwfyVBoN1m5WbQAyf',
      'DybNNj1H5Yo9JV4zQTSZTrWdWLWGdYPM84LCL53uCyjS',
      'ADkZT6CyyfV2xCE7GHhD592E4UMy7DBA8vKR4maTSHJo',
      'CgA4yPyXkTLNQTj8vqTahEe4xvsNRjfQ4YuF22qhir4u',
      '4C7iR2BKUYPsPADBiKqBZ9iYnhVrcqbrCSsLhFHCYqxS',
      '6vQd7Sw4pQHyB6rkPW6s9j3ir6jQeHjqXtnGr4tRVuFz',
      'EtDixXg72aFinnVSoLewXyuGd7ZG1wJ3E1Z8h7W1bRLK',
      '5AcdpucdAigyCCw7dYnY9UkWFQusmD3bMW7Q6M5MLyiM',
      'CJu2REP2NFdaGnUhENbLm4mLu3Zwggf574ZEaqBoRN9Y',
      'Nvgja9qFMA4XteMWrXqwDiJae1VgwVnC9KtEK9bV3F7',
      '2ggc5UTwzsUaYe3EFmo5vp8Jek7KeHxxZjaLfYvSXFP8',
      '9NkN2mq5PbFEjYHMH2L77Udsesux3JL7fnYqMrcveMku',
      '7wZkJrw56S8kcJ67VsYCvxQPu72GGyCLZPPz86DCRqCe',
      'AN8YMdsAwwh6uCJgPmpVxzoyL391QjX9tmU7GWzRKxdA',
      'HW8LumeFnPGGZfBSM4NuZ7yp9PALYAUErLT2b8CssHUc',
      '6HJctiD7icf3W9HcYHUx4WrZBpkMnJxDKLBXgDeuipfz',
      '6UhCCSzz8jMKnQtFjiVainFLDWKTCepRakvjGDsih46',
      'J5s1Q5ECEuvcyr8hfCVJxdebmwiQTGWbNGXu8GLfnSBj',
      'BcPHsbz9MxxnfX2BWNVAz8vbyJ8JAzr2TyMcUZxgbZPk',
      'Dc5pZQFUtmMY4tqf37KhBxwSHoFDiWDWShdfpbjtYVqG',
      '22W58bMNpfn5Nsf6ifvT4r8j622t3ez6cLNHP19DJN8i',
      '69vjj2v5Ke56t1xiz3JEvWBvPxw6aCVdEfQyaiSxw5M1',
      '6WWUQuethroETYkvjHwzK8SBsBrFXRU6N3r3wGGHhBNJ',
      '7s8mN56GZAwv7xUsYG5NGJUY28zXRYfM2MC3adV8fzmS',
      '36YoDeNb5vbzocAxrBFqs75DPwBHVVQyR1HE792rEZhU',
      '8uaT7jBZeZquyCGZf2guEXT6qxRzJLRupWqNo7J9GVWC',
      'HMwbgUHTSUByt1wn939V7ZmtkLmZzSwDrQF8g735Ke7b',
      'Hz57mJ1hFHNKqedeSL2XKLCVUgZz4KrmhrBUpqaof7w2',
      '2YKP9Gdvu8mZHTQ2gVs3GFhE6CFuPmzhKor9rWS2dNcb',
      '2t356FsLEPcMRT7Nf6wCtYhxDGPqGk617h7H3QDTWadN',
      '34eG1YjaeTuhAXRAgQ9iiALNBBANmc17M1r7EGsfiVSJ',
      'GcfmCd2iTPW66ZmerMSJQGdF5BvMdsGdjeRr8jdgWJvc',
      'oHHaActByLEv9ju6x6EieuTkw7yswf3cD8T6zL7d8Mp',
      'XvVPwD5vksVYQFbn56ZkKCRptMkycPwYTKUWNB2Xh5f',
      '8gqQ8Z2Voot9UVEUEvo95sbUSb5jRnTVFgh2fyJ1gpuW',
      'H5skicpD6dtAy2KmbZMCPk4nL5xx8Ye26PZuoJLNDXkX',
      '6CBsUzoznswJLacHuv5nbRExvdiTQo5MD4A4AMm2S5vc',
      '6Fh1ibLTEukUKEsxHiomJRe1pyrJ9LWLiGhgg5huugHw',
      'ARCYeKaxqU6gZhWCzYHeyFMPEAT87yVrQrnVESsm3NfW',
      '9DQrJomnSKjakL9paTgMkFXazwHuRBg83kEj9K7jQxKq',
      'BNJm3VSrZEvKsCpVA5h2Ya7Z6BHWMSnQWtShcHVWgQpL',
      '6skFEGLGTjPDWbh384aA2MXLafNwDjAJoB7fFhgX8o7E',
      'CMJsyibqSGLENXoCMR66fSQ1tSgoK9qBbao765CRy9i3',
      '9D1KdYAmkeb9kav8rDLnqQ3SdxKjLxgjgV8yT8cPHPGP',
      '6VB3T5xSpefLx6otMyN8SdCow54GSzibbBe8epdrreTk',
      'CBJNRDCv8xKST8T5pQjTrhSMPNMfdFKyMMaoLbZd5CfZ',
      '5h89RnR4SBk3ZJaDoCEZvrbpSozxQEvtR66DbGAiCWRh',
      'AtMK1PwRJ9FWLJQwnJrWXSrS1e87RkXieVyxpGXNtTe3',
      '6xCGdHHdtqN4BkaZ4CqXVjNXnhv9ig6iQmUgQFC5o4KA',
      'Fb1eSwi1EaXDYJmMtDX6nESuzkJEPxgnaEa2Qy87hvnv',
      '7HRYsuMBw3NGb7r7EhoukNfHWxgswRHA7MDFy6ynJ6Jd',
      '2rNEuiiMbruTbBv1RTdhnLbV8XW2wpxZ2ToHW3pRZsyn',
      '6tFRMbJ9r8D19PzHDzowFsANGz5zpJ7q68ve8sCtLhUK',
      '2FxttPXDzPr3hp8th55jGwKQDK658eY9fAYgPS5BQsgG',
      '9oSK1nvoTuP1w6jhEWuJcC9dQRDVrBaeih4SFcvhtd1D',
      'AXmvC1aTytCFHK7gpLSwA4jmBDeboxP3ihMrZbneHrU8',
      'Cy8qmbBqNt5s6iv7QMKaEaSSh42qcjdSHBX7f6MXLFqj',
      '6C6sYnvJ8UAZ1uNgMbNeab8pM4emZn4zricGn16YZuX1',
      'GwWgugJfPeu7t2eybUEuvJk454pWPngMvuK4VAs6YMoF',
      '4z6tVjyfWGSvY413cSfQXaGhatfo81hnZwsWZiNtjnac',
      'GSV9W7bhDtbyb8XTq4Dy5TUuWxRH69DEixmW38EdgJdM',
      '9M5fLJZiYTUUmrK7kCqBfqDFLdmsTWeoU1s3bTGrB64t',
      'HCDKJuiXenPM8e1Qaa268HTPDH8k6jdoBPBHWPfBHTfx',
      '48U9e6UbwY59KcUUvEegyRBS54MLx4A24hjLxFonGkH4',
      '7emAwR6QUXGehvZdeCHH7efkjCkDD1U95ksxQhrpxAqg',
      '5y4rHLyv4C9Y8YBDyBex9fanCggE5vSLUJgYsCyWpX2w',
      '9nQ3a8fFGjT3Z1U2Fn3hzvXmG5jGQ3AXpchAE1LQSJ7y',
      '2wP9kvh3Uwm4Y3Zprsx2PxFPxMxZw5mePWwp7ukBQtms',
      'HZG6KXnzP7ZgWYabSAUvHcyxG85DVUkQf2UBUcCEEdTy',
      'Fm7cMpTzBwyNybmEu67mU29FpKJZXCz38VuHiCh3MA3Z',
      '6HJutXDqXLUo3otxnLWtC7FiXkxePbLZoa84TYaJ4qg7',
      'DtXURXnabk5EsPAQhivDYhZWYYQScLGDVyZdfmfGiTWA',
      'E3CpBTZ2ZprQ5XKprw5TBQkbJ3DzYGJQx1AhyApyKvch',
      'CupTKerusECgKEqYzuSMk7wtKYnmo5WXZ2gtJtKreS6R',
      'DTBkMR3i697w7JPwcvCdrcqtxRhS8FtgoHZqp87Sodqf',
      '5fRc469U46WVkH9WWYQ2wUuS3cdrX14WNmHGyaqg87Fe',
      'HGZgSEpRbwY3H54vyrUfqn8RXqDA23qT9yLqyxZXZTNW',
    ])
    await expect(subgraphs.length).toEqual(106)
  })

  //TODO: Setup constrained subraphDeployments query that works both against graph-node and the gateway

  // test('Fetch subgraph deployments (constrained)', async () => {
  //   const deployments = await networkMonitor.subgraphDeployments(59022843)
  //   await expect(deployments.length).toEqual(589)
  // }, 30000)

  test('Fetch subgraph deployments (unconstrained block)', async () => {
    const deployments = await networkMonitor.subgraphDeployments()
    await expect(deployments.length).toBeGreaterThan(500)
  }, 40000)
})

describe('Network layer detection', () => {
  interface NetworkLayer {
    name: string
    l1: boolean
    l2: boolean
  }

  // Should be true for L1 and false for L2
  const l1Networks: NetworkLayer[] = ['mainnet', 'eip155:1', 'sepolia'].map(
    (name: string) => ({ name, l1: true, l2: false }),
  )

  // Should be false for L1 and true for L2
  const l2Networks: NetworkLayer[] = [
    'arbitrum-one',
    'eip155:42161',
    'eip155:421614',
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
