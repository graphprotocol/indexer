import fetch from 'isomorphic-fetch'
import { Argv } from 'yargs'
import { createClient } from '@urql/core'
import { Wallet, providers, BigNumber } from 'ethers'

import {
  createLogger,
  connectContracts,
  createMetrics,
  createMetricsServer,
  toAddress,
  connectDatabase,
} from '@graphprotocol/common-ts'
import { SigningWallet } from '@statechannels/server-wallet/lib/src/models/signing-wallet'
import { ReceiptManager } from '@graphprotocol/receipt-manager'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
} from '@graphprotocol/indexer-common'

import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { ensureAttestationSigners, monitorActiveAllocations } from '../allocations'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv): Argv => {
    return yargs
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('mnemonic', {
        describe: 'Mnemonic for the operator wallet',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('indexer-address', {
        describe: 'Ethereum address of the indexer',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('port', {
        description: 'Port to serve from',
        type: 'number',
        default: 7600,
        group: 'Indexer Infrastructure',
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint to forward queries to',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .option('free-query-auth-token', {
        description: 'Auth token that clients can use to query for free',
        type: 'array',
      })
      .option('postgres-host', {
        description: 'Postgres host',
        type: 'string',
        required: true,
        group: 'Postgres',
      })
      .option('postgres-port', {
        description: 'Postgres port',
        type: 'number',
        default: 5432,
        group: 'Postgres',
      })
      .option('postgres-username', {
        description: 'Postgres username',
        type: 'string',
        required: false,
        default: 'postgres',
        group: 'Postgres',
      })
      .option('postgres-password', {
        description: 'Postgres password',
        type: 'string',
        default: '',
        required: false,
        group: 'Postgres',
      })
      .option('postgres-database', {
        description: 'Postgres database name',
        type: 'string',
        required: true,
        group: 'Postgres',
      })
      .option('network-subgraph-endpoint', {
        description: 'Endpoint to query the network subgraph from',
        type: 'string',
        required: true,
        group: 'Network Subgraph',
      })
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (argv: { [key: string]: any } & Argv['argv']): Promise<void> => {
    let logger = createLogger({ name: 'IndexerService', async: false })

    logger.info('Starting up...')

    const wallet = Wallet.fromMnemonic(argv.mnemonic)
    const indexerAddress = toAddress(argv.indexerAddress)

    logger = logger.child({ indexer: indexerAddress, operator: wallet.address })

    logger.info('Connect to database', {
      host: argv.postgresHost,
      port: argv.postgresPort,
      database: argv.postgresDatabase,
    })
    const sequelize = await connectDatabase({
      logging: undefined,
      host: argv.postgresHost,
      port: argv.postgresPort,
      username: argv.postgresUsername,
      password: argv.postgresPassword,
      database: argv.postgresDatabase,
    })
    const models = defineIndexerManagementModels(sequelize)
    await sequelize.sync()
    logger.info('Successfully connected to database')

    logger.info(`Connect to network`)
    const networkSubgraph = createClient({ url: argv.networkSubgraphEndpoint, fetch })
    logger.info(`Successfully connected to network`)

    logger.info('Connecting to Ethereum', { provider: argv.ethereum })
    let ethereum
    try {
      ethereum = new URL(argv.ethereum)
    } catch (e) {
      throw new Error(`Invalid Ethereum URL '${argv.ethereum}': ${e}`)
    }
    const web3 = new providers.JsonRpcProvider({
      url: ethereum.toString(),
      user: ethereum.username,
      password: ethereum.password,
    })
    const network = await web3.getNetwork()
    logger.info('Successfully connected to Ethereum', { provider: web3.connection.url })

    logger.info('Connect to contracts', {
      network: network.name,
      chainId: network.chainId,
    })
    const contracts = await connectContracts(web3, network.chainId)
    logger.info('Successfully to contracts')

    // Spin up a metrics server
    const metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
    })

    // Create receipt manager
    const receiptManager = new ReceiptManager(
      logger.child({ component: 'ReceiptManager' }),
      wallet.privateKey,
    )
    await receiptManager.migrateWalletDB()

    // Ensure the address is checksummed
    const address = toAddress(wallet.address)
    await SigningWallet.query()
      .insert(SigningWallet.fromJson({ privateKey: wallet.privateKey, address }))
      .catch(() => {
        // Ignore duplicate entry error; handle constraint violation by warning
        // the user that they already have a _different_ signing key below:
      })
      .finally(() => {
        logger.info('Seeded state channels wallet with operator key')
      })

    logger = logger.child({
      indexer: indexerAddress.toString(),
      operator: address.toString(),
    })

    // Monitor active indexer allocations
    const allocations = monitorActiveAllocations({
      indexer: indexerAddress,
      logger,
      networkSubgraph,
      interval: 10000,
    })

    // Ensure there is an attestation signer for every allocation
    const signers = ensureAttestationSigners({ logger, allocations, wallet })

    // Create a query processor for paid queries
    const queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      receiptManager,
      chainId: network.chainId,
      disputeManagerAddress: contracts.disputeManager.address,
      signers,
    })

    const indexerManagementClient = await createIndexerManagementClient({
      models,
      address,
      contracts,
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

    // Spin up a basic webserver
    await createServer({
      logger: logger.child({ component: 'Server' }),
      port: argv.port,
      receiptManager,
      queryProcessor,
      metrics,
      graphNodeStatusEndpoint: argv.graphNodeStatusEndpoint,
      freeQueryAuthToken: argv.freeQueryAuthToken,
      indexerManagementClient,
    })
  },
}
