import path from 'path'
import fetch from 'isomorphic-fetch'
import readPkg from 'read-pkg'
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
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  indexerError,
  IndexerErrorCode,
  registerIndexerErrorMetrics,
  createVectorClient,
  defineQueryFeeModels,
} from '@graphprotocol/indexer-common'

import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { ensureAttestationSigners, monitorActiveAllocations } from '../allocations'
import { AllocationReceiptManager, TransferReceiptManager } from '../query-fees'

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
      .option('ethereum-network', {
        description: 'Ethereum network',
        type: 'string',
        required: false,
        default: 'mainnet',
        group: 'Ethereum',
      })
      .option('ethereum-polling-interval', {
        description: 'Polling interval for the Ethereum provider (ms)',
        type: 'number',
        default: 4000,
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
        description: 'Port to serve queries at',
        type: 'number',
        default: 7600,
        group: 'Indexer Infrastructure',
      })
      .option('metrics-port', {
        description: 'Port to serve Prometheus metrics at',
        type: 'number',
        default: 7300,
        group: 'Indexer Infrastructure',
      })
      .option('gcloud-profiling', {
        type: 'boolean',
        description: 'Whether to enable Google Cloud profiling',
        default: false,
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
      .option('log-level', {
        description: 'Log level',
        type: 'string',
        default: 'debug',
        group: 'Indexer Infrastructure',
      })
      .option('vector-node', {
        description: 'URL of a vector node',
        type: 'string',
        required: false,
        group: 'Scalar',
      })
      .option('vector-router', {
        description: 'Public identifier of the vector router',
        type: 'string',
        required: false,
        group: 'Scalar',
      })
      .option('vector-transfer-definition', {
        description: 'Address of the Graph transfer definition contract',
        type: 'string',
        default: 'auto',
        group: 'Scalar',
      })
      .option('allocation-syncing-interval', {
        description: 'Interval (in ms) for syncing indexer allocations from the network',
        type: 'number',
        default: 120_000,
        group: 'Network Subgraph',
      })
      .option('use-vector', {
        description:
          'Whether to use Vector as the off-chain settlement layer for query fees',
        type: 'boolean',
        default: false,
        implies: ['vector-node', 'vector-router'],
      })
      .option('client-signer-address', {
        description: 'Address that signs query fee receipts from a known client',
        type: 'string',
        required: true,
        conflicts: ['use-vector'],
      })
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (argv: { [key: string]: any } & Argv['argv']): Promise<void> => {
    let logger = createLogger({
      name: 'IndexerService',
      async: false,
      level: argv.logLevel,
    })

    process.on('unhandledRejection', err => {
      logger.warn(`Unhandled promise rejection`, {
        err: indexerError(IndexerErrorCode.IE035, err),
      })
    })

    process.on('uncaughtException', err => {
      logger.warn(`Uncaught exception`, {
        err: indexerError(IndexerErrorCode.IE036, err),
      })
    })

    const pkg = await readPkg({ cwd: path.join(__dirname, '..', '..') })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const dependencies = pkg.dependencies!
    const release = {
      version: pkg.version,
      dependencies: {
        '@graphprotocol/common-ts': dependencies['@graphprotocol/common-ts'],
      },
    }

    logger.info('Starting up...', { version: pkg.version, deps: pkg.bundledDependencies })

    // Enable Google Cloud profiling if enabled
    if (argv.gcloudProfiling) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@google-cloud/profiler').start({
          serviceContext: {
            service: pkg.name.split('/').pop(),
            version: pkg.version,
          },
        })
      } catch (err) {
        logger.warn(`Failed to enable Google Cloud profiling, skipping`, { err })
      }
    }

    // Spin up a metrics server
    const metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
      port: argv.metricsPort,
    })

    // Register indexer error metrics so we can track any errors that happen
    // inside the service
    registerIndexerErrorMetrics(metrics)

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
    const paymentModels = defineQueryFeeModels(sequelize)
    const models = defineIndexerManagementModels(sequelize)
    await sequelize.sync()
    logger.info('Successfully connected to database')

    logger.info(`Connect to network`)
    const networkSubgraph = createClient({
      url: argv.networkSubgraphEndpoint,
      fetch,
      requestPolicy: 'network-only',
    })
    logger.info(`Successfully connected to network`)

    logger.info('Connecting to Ethereum', { provider: argv.ethereum })
    let ethereum
    try {
      ethereum = new URL(argv.ethereum)
    } catch (err) {
      logger.critical(`Invalid Ethereum URL`, {
        err: indexerError(IndexerErrorCode.IE002, err),
        url: argv.ethereum,
      })
      process.exit(1)
      return
    }
    const web3ProviderMetrics = {
      requests: new metrics.client.Counter({
        name: 'eth_provider_requests',
        help: 'Ethereum provider requests',
        registers: [metrics.registry],
        labelNames: ['method'],
      }),
    }

    if (ethereum.password && ethereum.protocol == 'http:') {
      logger.warn(
        'Ethereum endpoint does not use HTTPS, your authentication credentials may not be secure',
      )
    }

    const ethereumProvider = new providers.StaticJsonRpcProvider(
      {
        url: ethereum.toString(),
        user: ethereum.username,
        password: ethereum.password,
        allowInsecureAuthentication: true,
      },
      argv.ethereumNetwork,
    )
    ethereumProvider.pollingInterval = argv.ethereumPollingInterval

    ethereumProvider.on('debug', info => {
      if (info.action === 'response') {
        web3ProviderMetrics.requests.inc({
          method: info.request.method,
        })

        logger.trace('Ethereum request', {
          method: info.request.method,
          params: info.request.params,
          response: info.response,
        })
      }
    })

    ethereumProvider.on('network', (newNetwork, oldNetwork) => {
      logger.trace('Ethereum network change', {
        oldNetwork: oldNetwork,
        newNetwork: newNetwork,
      })
    })

    const network = await ethereumProvider.getNetwork()
    logger.info('Successfully connected to Ethereum', {
      provider: ethereumProvider.connection.url,
      pollingInterval: ethereumProvider.pollingInterval,
      network: await ethereumProvider.detectNetwork(),
    })

    logger.info('Connect to contracts', {
      network: network.name,
      chainId: network.chainId,
    })

    let contracts = undefined
    try {
      contracts = await connectContracts(ethereumProvider, network.chainId)
    } catch (error) {
      logger.error(
        `Failed to connect to contracts, please ensure you are using the intended Ethereum Network`,
        {
          error,
        },
      )
      throw error
    }

    logger.info('Successfully connected to contracts')

    let receiptManager

    if (argv.useVector) {
      // Identify the Graph transfer definition address
      // TODO: Pick it from the `contracts`
      const vectorTransferDefinition = toAddress(
        argv.vectorTransferDefinition === 'auto'
          ? network.chainId === 1
            ? '0x0000000000000000000000000000000000000000'
            : '0x87b1A09EfE2DA4022fc4a152D10dd2Df36c67544'
          : argv.vectorTransferDefinition,
      )

      // Create vector client
      const vector = await createVectorClient({
        logger,
        ethereum: ethereumProvider,
        wallet,
        contracts,
        metrics,
        nodeUrl: argv.vectorNode,
        routerIdentifier: argv.vectorRouter,
      })

      // Create receipt manager
      receiptManager = new TransferReceiptManager(
        sequelize,
        paymentModels,
        logger,
        vector,
        vectorTransferDefinition,
      )
    } else {
      receiptManager = new AllocationReceiptManager(
        sequelize,
        paymentModels,
        logger,
        toAddress(argv.clientSignerAddress),
      )
    }

    // Ensure the address is checksummed
    const address = toAddress(wallet.address)

    logger = logger.child({
      indexer: indexerAddress.toString(),
      operator: address.toString(),
    })

    // Monitor active indexer allocations
    const allocations = monitorActiveAllocations({
      indexer: indexerAddress,
      logger,
      networkSubgraph,
      interval: argv.allocationSyncingInterval,
    })

    // Ensure there is an attestation signer for every allocation
    const signers = ensureAttestationSigners({
      logger,
      allocations,
      wallet,
      chainId: network.chainId,
      disputeManagerAddress: contracts.disputeManager.address,
    })

    // Create a query processor for paid queries
    const queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      receiptManager,
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
      queryProcessor,
      metrics,
      graphNodeStatusEndpoint: argv.graphNodeStatusEndpoint,
      freeQueryAuthToken: argv.freeQueryAuthToken,
      indexerManagementClient,
      release,
      operatorPublicKey: wallet.publicKey,
    })
  },
}
