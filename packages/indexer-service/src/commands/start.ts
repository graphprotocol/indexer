import path from 'path'
import { readPackage } from 'read-pkg'
import { Argv } from 'yargs'
import { Wallet, providers, BigNumber } from 'ethers'

import {
  createLogger,
  connectContracts,
  createMetrics,
  createMetricsServer,
  toAddress,
  connectDatabase,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  indexerError,
  IndexerErrorCode,
  registerIndexerErrorMetrics,
  defineQueryFeeModels,
  NetworkSubgraph,
  IndexingStatusResolver,
} from '@graphprotocol/indexer-common'

import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { ensureAttestationSigners, monitorEligibleAllocations } from '../allocations'
import { AllocationReceiptManager } from '../query-fees'

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
      .option('network-subgraph-auth-token', {
        description: 'Bearer token to require for /network queries',
        type: 'string',
        required: false,
        group: 'Network Subgraph',
      })
      .option('serve-network-subgraph', {
        description: 'Whether to serve the network subgraph at /network',
        type: 'boolean',
        required: false,
        default: false,
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
        group: 'Query Fees',
      })
      .option('vector-router', {
        description: 'Public identifier of the vector router',
        type: 'string',
        required: false,
        group: 'Query Fees',
      })
      .option('vector-transfer-definition', {
        description: 'Address of the Graph transfer definition contract',
        type: 'string',
        default: 'auto',
        group: 'Query Fees',
      })
      .option('allocation-syncing-interval', {
        description: 'Interval (in ms) for syncing indexer allocations from the network',
        type: 'number',
        default: 120_000,
        group: 'Network Subgraph',
      })
      .option('client-signer-address', {
        description: 'Address that signs query fee receipts from a known client',
        type: 'string',
        required: false,
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

    const pkg = await readPackage({ cwd: path.join(__dirname, '..', '..') })
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
    const queryFeeModels = defineQueryFeeModels(sequelize)
    const models = defineIndexerManagementModels(sequelize)
    // Note: Typically, you'd call `sequelize.sync()` here to sync the models
    // to the database; however, this can cause conflicts with the migrations
    // run by indexer agent. Hence we leave syncing and migrating entirely to
    // the agent and assume the models are up to date in the service.
    logger.info('Successfully connected to database')

    logger.info(`Connect to network`)
    const indexingStatusResolver = new IndexingStatusResolver({
      logger,
      statusEndpoint: argv.graphNodeStatusEndpoint,
    })
    const networkSubgraph = await NetworkSubgraph.create({
      logger,
      endpoint: argv.networkSubgraphEndpoint,
      deployment: argv.networkSubgraphDeployment
        ? {
            indexingStatusResolver,
            deployment: new SubgraphDeploymentID(argv.networkSubgraphDeployment),
            graphNodeQueryEndpoint: argv.graphNodeQueryEndpoint,
          }
        : undefined,
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

    const receiptManager = new AllocationReceiptManager(
      sequelize,
      queryFeeModels,
      logger,
      toAddress(argv.clientSignerAddress),
    )

    // Ensure the address is checksummed
    const address = toAddress(wallet.address)

    logger = logger.child({
      indexer: indexerAddress.toString(),
      operator: address.toString(),
    })

    // Monitor indexer allocations that we may receive traffic for
    const allocations = monitorEligibleAllocations({
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
      indexingStatusResolver,
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
      networkSubgraph,
      networkSubgraphAuthToken: argv.networkSubgraphAuthToken,
      serveNetworkSubgraph: argv.serveNetworkSubgraph,
    })
  },
}
