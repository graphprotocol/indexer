/**
 * Assumes a graph-node is running and is accessible at http://127.0.0.1
 */

import http from 'http'
import supertest from 'supertest'
import { BigNumber, Wallet } from 'ethers'
import { Sequelize } from 'sequelize'
import { Socket } from 'net'

import {
  connectContracts,
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  NetworkContracts,
  toAddress,
} from '@graphprotocol/common-ts'

import { createServer } from '..'
import { QueryProcessor } from '../../queries'
import { ensureAttestationSigners } from '../../allocations'
import { AllocationReceiptManager } from '../../query-fees'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  IndexerManagementClient,
  IndexerManagementModels,
  monitorEligibleAllocations,
  NetworkSubgraph,
  QueryFeeModels,
  getTestProvider,
  GraphNode,
} from '@graphprotocol/indexer-common'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

let logger: Logger
let server: http.Server
let sockets: Socket[] = []
let sequelize: Sequelize
let models: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let address: string
let contracts: NetworkContracts
let networkSubgraph: NetworkSubgraph
let client: IndexerManagementClient
let receiptManager: AllocationReceiptManager

const setup = async () => {
  logger = createLogger({ name: 'server.test.ts', async: false, level: __LOG_LEVEL__ })
  const metrics = createMetrics()

  sequelize = await connectDatabase(__DATABASE__)

  queryFeeModels = defineQueryFeeModels(sequelize)
  models = defineIndexerManagementModels(sequelize)
  address = '0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1'
  contracts = await connectContracts(getTestProvider('sepolia'), 11155111, undefined)
  sequelize = await sequelize.sync({ force: true })
  const statusEndpoint = 'http://127.0.0.1:8030/graphql'
  const queryEndpoint = 'http://127.0.0.1:8000/'

  const INDEXER_TEST_API_KEY: string = process.env['INDEXER_TEST_API_KEY'] || ''
  networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint: `https://gateway-arbitrum.network.thegraph.com/api/${INDEXER_TEST_API_KEY}/subgraphs/name/graphprotocol/graph-network-arbitrum-sepolia`,
    deployment: undefined,
  })

  const graphNode = new GraphNode(
    logger,
    // We can use a fake Graph Node admin endpoint here because Indexer Service
    // doesn't need to perform management actions on Graph Node.
    'http://fake-graph-node-admin-endpoint',
    queryEndpoint,
    statusEndpoint,
  )
  client = await createIndexerManagementClient({
    models,
    graphNode,
    logger,
    defaults: {
      // This is just a dummy, since we're never writing to the management
      // client from the indexer service.
      globalIndexingRule: {
        allocationAmount: BigNumber.from('0'),
      },
    },
    multiNetworks: undefined,
  })

  receiptManager = new AllocationReceiptManager(
    sequelize,
    queryFeeModels,
    logger,
    toAddress(address), //update maybe
    'eip155:11155111',
  )

  const release = {
    version: '0.0.1',
    dependencies: {
      '@graphprotocol/common-ts': '1.8.0',
    },
  }

  // Monitor indexer allocations that we may receive traffic for
  const allocations = monitorEligibleAllocations({
    protocolNetwork: 'eip155:11155111',
    indexer: toAddress(address),
    logger,
    networkSubgraph,
    interval: 120_000,
  })
  const wallet = Wallet.fromMnemonic(
    'myth like bonus scare over problem client lizard pioneer submit female collect',
  )

  // Ensure there is an attestation signer for every allocation
  const signers = ensureAttestationSigners({
    logger,
    allocations,
    wallet,
    chainId: 4,
    disputeManagerAddress: contracts.disputeManager.address,
  })

  const queryProcessor = new QueryProcessor({
    logger: logger.child({ component: 'QueryProcessor' }),
    graphNode: 'http://127.0.0.1:8000/',
    metrics,
    receiptManager,
    queryTimingLogs: false,
    signers,
  })

  server = await createServer({
    logger: logger.child({ component: 'Server' }),
    port: 9600,
    queryProcessor,
    graphNodeStatusEndpoint: statusEndpoint,
    metrics,
    freeQueryAuthToken: '',
    indexerManagementClient: client,
    release,
    operatorPublicKey: wallet.publicKey,
    networkSubgraph,
    networkSubgraphAuthToken: 'superdupersecrettoken',
    serveNetworkSubgraph: false,
    infoRateLimit: 3,
    statusRateLimit: 2,
    bodySizeLimit: 0.1,
  })
  server.on('connection', socket => {
    logger.debug('Connection established', { socket })
    sockets.push(socket)
    socket.on('close', () => (sockets = sockets.filter(curr => curr !== socket)))
  })
  process.on('SIGTERM', await shutdownServer)
  process.on('SIGINT', await shutdownServer)
}

const shutdownServer = async () => {
  logger.debug('Received kill signal, shutting down gracefully')
  if (server) {
    server.close(() => {
      logger.debug('Closed out remaining connections')
    })
  }
  if (sockets.length > 0) {
    sockets.forEach(socket => socket.destroy())
  }
}

const teardown = async () => {
  await shutdownServer()
  await sequelize.drop({})
}

// Helpers for sending test requests
const testGetRequest = async (
  path: string,
  expectedStatusCode: number,
  expectedResponse: object | string,
) => {
  const response = await supertest(server).get(path)
  expect(response.status).toEqual(expectedStatusCode)
  if ((response.status === 429) | (response.status === 500)) {
    expect(response.text).toEqual(expectedResponse)
  } else if (response.status === 200) {
    expect(response.body).toEqual(expectedResponse)
  }
}

const testGraphQLRequest = async (
  path: string,
  query: object,
  expectedStatusCode: number,
  expectedResponse: object | string,
) => {
  const response = await supertest(server)
    .post(path)
    .send(query)
    .set('Accept', 'application/json')

  expect(response.status).toEqual(expectedStatusCode)
  if ((response.status === 429) | (response.status === 500)) {
    expect(response.text).toEqual(expectedResponse)
  } else if (response.status === 200) {
    expect(response.body).toEqual(expectedResponse)
  }
}

describe('Server', () => {
  beforeAll(setup)
  afterAll(teardown)

  it('is ready to roll', done => {
    supertest(server).get('/').expect(200, done)
  })

  it('Operator info endpoint returns expected data', async () => {
    const expectedResponses: [number, object | string][] = [
      [
        200,
        {
          publicKey:
            '0x04e68acfc0253a10620dff706b0a1b1f1f5833ea3beb3bde2250d5f271f3563606672ebc45e0b7ea2e816ecb70ca03137b1c9476eec63d4632e990020b7b6fba39',
        },
      ],
    ]
    for (const [expectedStatus, expectedResponse] of expectedResponses) {
      await testGetRequest('/operator/info', expectedStatus, expectedResponse)
    }
  })

  it('Subgraph deployment health endpoint returns expected data', async () => {
    const expectedResponses: [number, string][] = [[500, 'Invalid indexing status']]
    for (const [expectedStatus, expectedResponse] of expectedResponses) {
      await testGetRequest(
        '/subgraphs/health/Qmxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        expectedStatus,
        expectedResponse,
      )
    }
  })

  // Note: the rate limiting part of this test assumes the tests are run in sequence (suggest using --runInBand)
  it('Cost endpoint returns expected data and is rate limited correctly', async () => {
    const expectedResponses: [number, object | string][] = [
      [200, { data: { costModels: [] } }],
      [429, 'Too many requests, please try again later.'],
    ]

    for (const [expectedStatus, expectedResponse] of expectedResponses) {
      await testGraphQLRequest(
        '/cost',
        {
          query:
            '{costModels(deployments: ["Qmxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]){ deployment model } }',
        },
        expectedStatus,
        expectedResponse,
      )
    }
  })

  it('Status endpoint returns expected data and is rate limited correctly', async () => {
    const expectedResponses: [number, object | string][] = [
      [200, { data: { indexingStatuses: [] } }],
      [200, { data: { indexingStatuses: [] } }],
      [429, 'Too many requests, please try again later.'],
    ]

    for (const [expectedStatus, expectedResponse] of expectedResponses) {
      await testGraphQLRequest(
        '/status',
        {
          query:
            '{indexingStatuses(subgraphs: ["Qmxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]){ subgraph health } }',
        },
        expectedStatus,
        expectedResponse,
      )
    }
  })
})
