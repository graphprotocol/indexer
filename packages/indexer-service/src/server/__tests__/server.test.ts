/**
 * Assumes a graph-node is running
 */

import http from 'http'
import supertest from 'supertest'
import { BigNumber, ethers, Wallet } from 'ethers'
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
import { ensureAttestationSigners, monitorEligibleAllocations } from '../../allocations'
import { AllocationReceiptManager } from '../../query-fees'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  IndexerManagementClient,
  IndexerManagementModels,
  IndexingStatusResolver,
  NetworkSubgraph,
  QueryFeeModels,
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
let indexingStatusResolver: IndexingStatusResolver
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
  contracts = await connectContracts(ethers.getDefaultProvider('rinkeby'), 4)
  await sequelize.sync({ force: true })
  const statusEndpoint = 'http://localhost:8030/graphql'
  indexingStatusResolver = new IndexingStatusResolver({
    logger: logger,
    statusEndpoint,
  })
  networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint: 'https://gateway.testnet.thegraph.com/network',
    deployment: undefined,
  })
  const indexNodeIDs = ['node_1']
  client = await createIndexerManagementClient({
    models,
    address,
    contracts,
    indexingStatusResolver,
    indexNodeIDs,
    deploymentManagementEndpoint: statusEndpoint,
    networkSubgraph,
    logger,
    defaults: {
      // This is just a dummy, since we're never writing to the management
      // client from the indexer service.
      globalIndexingRule: {
        allocationAmount: BigNumber.from('0'),
      },
    },
    features: {
      injectDai: true,
    },
  })

  receiptManager = new AllocationReceiptManager(
    sequelize,
    queryFeeModels,
    logger,
    toAddress(address), //update maybe
  )

  const release = {
    version: '0.0.1',
    dependencies: {
      '@graphprotocol/common-ts': '1.8.0',
    },
  }

  // Monitor indexer allocations that we may receive traffic for
  const allocations = monitorEligibleAllocations({
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
    graphNode: 'http://localhost:8000/',
    metrics,
    receiptManager,
    signers,
  })

  server = await createServer({
    logger,
    port: 9600,
    queryProcessor,
    graphNodeStatusEndpoint: 'http://localhost:8030/graphql',
    metrics,
    freeQueryAuthToken: '',
    indexerManagementClient: client,
    release,
    operatorPublicKey: wallet.publicKey,
    networkSubgraph,
    networkSubgraphAuthToken: 'superdupersecrettoken',
    serveNetworkSubgraph: false,
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

describe('Server', () => {
  beforeAll(setup)
  afterAll(teardown)

  it('is ready to roll', done => {
    supertest(server).get('/').expect(200, done)
  })
})
