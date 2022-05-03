import path from 'path'
import { Argv } from 'yargs'
import { SequelizeStorage, Umzug } from 'umzug'
import {
  connectContracts,
  connectDatabase,
  createLogger,
  createMetrics,
  createMetricsServer,
  formatGRT,
  parseGRT,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  AllocationReceiptCollector,
  createIndexerManagementClient,
  createIndexerManagementServer,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  indexerError,
  IndexerErrorCode,
  IndexingStatusResolver,
  Network,
  NetworkSubgraph,
  registerIndexerErrorMetrics,
} from '@graphprotocol/indexer-common'
import { startAgent } from '../agent'
import { Indexer } from '../indexer'
import { providers, Wallet } from 'ethers'
import { startCostModelAutomation } from '../cost'
import { createSyncingServer } from '../syncing-server'
import { monitorEthBalance } from '../utils'
import {
  AllocationManagementMode,
  NetworkMonitor,
} from '@graphprotocol/indexer-common'

export default {
  command: 'start',
  describe: 'Start the agent',
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
      .option('gas-increase-timeout', {
        description:
          'Time (in seconds) after which transactions will be resubmitted with a higher gas price',
        type: 'number',
        default: 240,
        group: 'Ethereum',
        coerce: arg => arg * 1000,
      })
      .option('gas-increase-factor', {
        description:
          'Factor by which gas prices are increased when resubmitting transactions',
        type: 'number',
        default: 1.2,
        group: 'Ethereum',
      })
      .option('gas-price-max', {
        description: 'The maximum gas price (gwei) to use for transactions',
        type: 'number',
        default: 100,
        deprecated: true,
        group: 'Ethereum',
        coerce: arg => arg * 10 ** 9,
      })
      .option('base-fee-per-gas-max', {
        description:
          'The maximum base fee per gas (gwei) to use for transactions, for legacy transactions this will be treated as the max gas price',
        type: 'number',
        required: false,
        group: 'Ethereum',
        coerce: arg => arg * 10 ** 9,
      })
      .option('transaction-attempts', {
        description:
          'The maximum number of transaction attempts (Use 0 for unlimited)',
        type: 'number',
        default: 0,
        group: 'Ethereum',
      })
      .option('mnemonic', {
        description: 'Mnemonic for the operator wallet',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('indexer-address', {
        description: 'Ethereum address of the indexer',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint for querying subgraphs',
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
      .option('graph-node-admin-endpoint', {
        description:
          'Graph Node endpoint for applying and updating subgraph deployments',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .option('public-indexer-url', {
        description: 'Indexer endpoint for receiving requests from the network',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .options('indexer-geo-coordinates', {
        description: `Coordinates describing the Indexer's location using latitude and longitude`,
        type: 'string',
        array: true,
        default: ['31.780715', '-41.179504'],
        group: 'Indexer Infrastructure',
        coerce: arg =>
          arg.reduce(
            (acc: string[], value: string) => [...acc, ...value.split(' ')],
            [],
          ),
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        group: 'Network Subgraph',
      })
      .option('network-subgraph-endpoint', {
        description: 'Endpoint to query the network subgraph from',
        type: 'string',
        group: 'Network Subgraph',
      })
      .option('allocate-on-network-subgraph', {
        description: 'Whether to allocate to the network subgraph',
        type: 'boolean',
        default: false,
        group: 'Network Subgraph',
      })
      .option('index-node-ids', {
        description:
          'Node IDs of Graph nodes to use for indexing (separated by commas)',
        type: 'string',
        array: true,
        required: true,
        coerce: arg =>
          arg.reduce(
            (acc: string[], value: string) => [...acc, ...value.split(',')],
            [],
          ),
        group: 'Indexer Infrastructure',
      })
      .option('default-allocation-amount', {
        description:
          'Default amount of GRT to allocate to a subgraph deployment',
        type: 'string',
        default: '0.01',
        required: false,
        group: 'Protocol',
        coerce: arg => parseGRT(arg),
      })
      .option('indexer-management-port', {
        description: 'Port to serve the indexer management API at',
        type: 'number',
        default: 8000,
        required: false,
        group: 'Indexer Infrastructure',
      })
      .option('metrics-port', {
        description: 'Port to serve Prometheus metrics at',
        type: 'number',
        defaut: 7300,
        required: false,
        group: 'Indexer Infrastructure',
      })
      .option('syncing-port', {
        description:
          'Port to serve the network subgraph and other syncing data for indexer service at',
        type: 'number',
        default: 8002,
        required: false,
        group: 'Indexer Infrastructure',
      })
      .option('restake-rewards', {
        description: `Restake claimed indexer rewards, if set to 'false' rewards will be returned to the wallet`,
        type: 'boolean',
        default: true,
        group: 'Indexer Infrastructure',
      })
      .option('rebate-claim-threshold', {
        description: `Minimum value of rebate for a single allocation (in GRT) in order for it to be included in a batch rebate claim on-chain`,
        type: 'string',
        default: '200', // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Indexer Infrastructure',
        coerce: arg => parseGRT(arg),
      })
      .option('rebate-claim-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'string',
        default: '2000',
        group: 'Indexer Infrastructure',
        coerce: arg => parseGRT(arg),
      })
      .option('rebate-claim-max-batch-size', {
        description: `Maximum number of rebates inside a batch. Upper bound is constrained by available system memory, and by the block gas limit`,
        type: 'number',
        default: 100,
        group: 'Indexer Infrastructure',
      })
      .option('voucher-redemption-threshold', {
        description: `Minimum value of rebate for a single allocation (in GRT) in order for it to be included in a batch rebate claim on-chain`,
        type: 'string',
        default: '200', // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Indexer Infrastructure',
        coerce: arg => parseGRT(arg),
      })
      .option('voucher-redemption-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'string',
        default: '2000',
        group: 'Indexer Infrastructure',
        coerce: arg => parseGRT(arg),
      })
      .option('voucher-redemption-max-batch-size', {
        description: `Maximum number of rebates inside a batch. Upper bound is constrained by available system memory, and by the block gas limit`,
        type: 'number',
        default: 100,
        group: 'Indexer Infrastructure',
      })
      .option('inject-dai', {
        description:
          'Inject the GRT to DAI/USDC conversion rate into cost model variables',
        type: 'boolean',
        default: true,
        group: 'Cost Models',
      })
      .option('dai-contract', {
        description:
          'Address of the DAI or USDC contract to use for the --inject-dai conversion rate',
        type: 'string',
        // Default to USDC
        default: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
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
      .option('log-level', {
        description: 'Log level',
        type: 'string',
        default: 'debug',
        group: 'Indexer Infrastructure',
      })
      .option('register', {
        description: 'Whether to register the indexer on chain',
        type: 'boolean',
        default: true,
        group: 'Protocol',
      })
      .option('offchain-subgraphs', {
        description:
          'Subgraphs to index that are not on chain (comma-separated)',
        type: 'string',
        array: true,
        default: [],
        coerce: arg =>
          arg
            .reduce(
              (acc: string[], value: string) => [...acc, ...value.split(',')],
              [],
            )
            .map((id: string) => id.trim())
            .filter((id: string) => id.length > 0),
      })
      .option('poi-disputable-epochs', {
        description:
          'The number of epochs in the past to look for potential POI disputes',
        type: 'number',
        default: 1,
        group: 'Disputes',
      })
      .option('poi-dispute-monitoring', {
        description: 'Monitor the network for potential POI disputes',
        type: 'boolean',
        default: false,
        group: 'Disputes',
      })
      .check(argv => {
        if (
          !argv['network-subgraph-endpoint'] &&
          !argv['network-subgraph-deployment']
        ) {
          return `At least one of --network-subgraph-endpoint and --network-subgraph-deployment must be provided`
        }
        if (argv['indexer-geo-coordinates']) {
          const [geo1, geo2] = argv['indexer-geo-coordinates']
          if (!+geo1 || !+geo2) {
            return 'Invalid --indexer-geo-coordinates provided. Must be of format e.g.: 31.780715 -41.179504'
          }
        }
        if (argv['gas-increase-timeout']) {
          if (argv['gas-increase-timeout'] < 30000) {
            return 'Invalid --gas-increase-timeout provided. Must be at least 30 seconds'
          }
        }
        if (argv['gas-increase-factor'] <= 1.0) {
          return 'Invalid --gas-increase-factor provided. Must be > 1.0'
        }
        if (
          !Number.isInteger(argv['rebate-claim-max-batch-size']) ||
          argv['rebate-claim-max-batch-size'] <= 0
        ) {
          return 'Invalid --rebate-claim-max-batch-size provided. Must be > 0 and an integer.'
        }
        return true
      })
      .option('vector-node', {
        description: 'URL of a vector node',
        type: 'string',
        group: 'Query Fees',
      })
      .option('vector-router', {
        description: 'Public identifier of the vector router',
        type: 'string',
        group: 'Query Fees',
      })
      .option('vector-transfer-definition', {
        description: 'Address of the Graph transfer definition contract',
        type: 'string',
        default: 'auto',
        group: 'Query Fees',
      })
      .option('vector-event-server', {
        description: 'External URL of the vector event server of the agent',
        type: 'string',
        group: 'Query Fees',
      })
      .option('vector-event-server-port', {
        description: 'Port to serve the vector event server at',
        type: 'number',
        required: false,
        default: 8001,
        group: 'Query Fees',
      })
      .option('allocation-exchange-contract', {
        description: 'Address of the contract to submit query fee vouchers to',
        type: 'string',
        required: false,
        default: 'auto',
        implies: ['collect-receipts-endpoint'],
        group: 'Query Fees',
      })
      .option('collect-receipts-endpoint', {
        description: 'Client endpoint for collecting receipts',
        type: 'string',
        required: false,
        implies: ['allocation-exchange-contract'],
        group: 'Query Fees',
      })
      .option('allocation-management', {
        description:
          'Indexer agent allocation management automation mode (auto|manual) ',
        type: 'string',
        required: false,
        default: 'auto',
        group: 'Indexer Infrastructure',
      })
  },
  handler: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    argv: { [key: string]: any } & Argv['argv'],
  ): Promise<void> => {
    const logger = createLogger({
      name: 'IndexerAgent',
      async: false,
      level: argv.logLevel,
    })

    if (argv.gasIncreaseTimeout < 90000) {
      logger.warn(
        'Gas increase timeout is set to less than 90 seconds (~ 6 blocks). This may lead to high gas usage',
        { gasIncreaseTimeout: argv.gasIncreaseTimeout / 1000.0 },
      )
    }

    if (argv.gasIncreaseFactor > 1.5) {
      logger.warn(
        `Gas increase factor is set to > 1.5. This may lead to high gas usage`,
        { gasIncreaseFactor: argv.gasIncreaseFactor },
      )
    }

    if (argv.rebateClaimThreshold.lt(argv.voucherRedemptionThreshold)) {
      logger.warn(
        `Rebate single minimum claim value is less than voucher minimum redemption value, but claims depend on redemptions`,
        {
          voucherRedemptionThreshold: formatGRT(
            argv.voucherRedemptionThreshold,
          ),
          rebateClaimThreshold: formatGRT(argv.rebateClaimThreshold),
        },
      )
    }

    if (argv.rebateClaimThreshold.eq(0)) {
      logger.warn(
        `Minimum query fee rebate value is 0 GRT, which may lead to claiming unprofitable rebates`,
      )
    }

    if (argv.rebateClaimMaxBatchSize > 200) {
      logger.warn(
        `Setting the max batch size for rebate claims to more than 200 may result in batches that are too large to fit into a block`,
        { rebateClaimMaxBatchSize: argv.rebateClaimMaxBatchSize },
      )
    }

    if (argv.voucherRedemptionThreshold.eq(0)) {
      logger.warn(
        `Minimum voucher redemption value is 0 GRT, which may lead to redeeming unprofitable vouchers`,
      )
    }

    if (argv.voucherRedemptionMaxBatchSize > 200) {
      logger.warn(
        `Setting the max batch size for voucher redemptions to more than 200 may result in batches that are too large to fit into a block`,
        { voucherRedemptionMaxBatchSize: argv.voucherRedemptionMaxBatchSize },
      )
    }

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

    // Spin up a metrics server
    const metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
      port: argv.metricsPort,
    })

    // Register indexer error metrics so we can track any errors that happen
    // inside the agent
    registerIndexerErrorMetrics(metrics)

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
    logger.info('Successfully connected to database')

    // Automatic database migrations
    logger.info(`Run database migrations`)

    // If the application is being executed using ts-node __dirname may be in /src rather than /dist
    const migrations_path = __dirname.includes('dist')
      ? path.join(__dirname, '..', 'db', 'migrations', '*.js')
      : path.join(__dirname, '..', '..', 'dist', 'db', 'migrations', '*.js')

    try {
      const umzug = new Umzug({
        migrations: {
          glob: migrations_path,
        },
        context: {
          queryInterface: sequelize.getQueryInterface(),
          logger,
        },
        storage: new SequelizeStorage({ sequelize }),
        logger: console,
      })
      const pending = await umzug.pending()
      const executed = await umzug.executed()
      logger.debug(`Migrations status`, { pending, executed })
      await umzug.up()
    } catch (err) {
      logger.fatal(`Failed to run database migrations`, {
        err: indexerError(IndexerErrorCode.IE001, err),
      })
      process.exit(1)
      return
    }
    logger.info(`Successfully ran database migrations`)

    logger.info(`Sync database models`)
    const managementModels = defineIndexerManagementModels(sequelize)
    const queryFeeModels = defineQueryFeeModels(sequelize)
    await sequelize.sync()
    logger.info(`Successfully synced database models`)

    logger.info(`Connect to Ethereum`, {
      provider: argv.ethereum,
      network: argv.ethereumNetwork,
    })

    let providerUrl
    try {
      providerUrl = new URL(argv.ethereum)
    } catch (err) {
      logger.fatal(`Invalid Ethereum URL`, {
        err: indexerError(IndexerErrorCode.IE002, err),
        url: argv.ethereum,
      })
      process.exit(1)
      return
    }

    const ethProviderMetrics = {
      requests: new metrics.client.Counter({
        name: 'eth_provider_requests',
        help: 'Ethereum provider requests',
        registers: [metrics.registry],
        labelNames: ['method'],
      }),
    }

    if (providerUrl.password && providerUrl.protocol == 'http:') {
      logger.warn(
        'Ethereum endpoint does not use HTTPS, your authentication credentials may not be secure',
      )
    }

    // Prevent passing empty basicAuth info
    let username
    let password
    if (providerUrl.username == '' && providerUrl.password == '') {
      username = undefined
      password = undefined
    } else {
      username = providerUrl.username
      password = providerUrl.password
    }

    const ethereumProvider = new providers.StaticJsonRpcProvider(
      {
        url: providerUrl.toString(),
        user: username,
        password: password,
        allowInsecureAuthentication: true,
      },
      argv.ethereumNetwork,
    )
    ethereumProvider.pollingInterval = argv.ethereumPollingInterval

    ethereumProvider.on('debug', info => {
      if (info.action === 'response') {
        ethProviderMetrics.requests.inc({
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

    const networkMeta = await ethereumProvider.getNetwork()
    logger.info(`Connected to Ethereum`, {
      provider: ethereumProvider.connection.url,
      pollingInterval: ethereumProvider.pollingInterval,
      network: await ethereumProvider.detectNetwork(),
    })

    logger.info(`Connect wallet`, {
      network: ethereumProvider.network.name,
      chainId: ethereumProvider.network.chainId,
    })
    let wallet = Wallet.fromMnemonic(argv.mnemonic)
    wallet = wallet.connect(ethereumProvider)
    logger.info(`Connected wallet`)

    logger.info(`Connect to contracts`, {
      network: networkMeta.name,
      chainId: networkMeta.chainId,
      providerNetworkChainID: ethereumProvider.network.chainId,
    })
    let contracts = undefined
    try {
      contracts = await connectContracts(
        wallet,
        ethereumProvider.network.chainId,
      )
    } catch (err) {
      logger.error(
        `Failed to connect to contracts, please ensure you are using the intended Ethereum network`,
        {
          err,
        },
      )
      process.exit(1)
    }
    logger.info(`Successfully connected to contracts`, {
      curation: contracts.curation.address,
      disputeManager: contracts.disputeManager.address,
      epochManager: contracts.epochManager.address,
      gns: contracts.gns.address,
      rewardsManager: contracts.rewardsManager.address,
      serviceRegistry: contracts.serviceRegistry.address,
      staking: contracts.staking.address,
      token: contracts.token.address,
    })

    const indexerAddress = toAddress(argv.indexerAddress)

    const indexingStatusResolver = new IndexingStatusResolver({
      logger: logger,
      statusEndpoint: argv.graphNodeStatusEndpoint,
    })

    const networkSubgraph = await NetworkSubgraph.create({
      logger,
      endpoint: argv.networkSubgraphEndpoint,
      deployment: argv.networkSubgraphDeployment
        ? {
            indexingStatusResolver: indexingStatusResolver,
            deployment: new SubgraphDeploymentID(
              argv.networkSubgraphDeployment,
            ),
            graphNodeQueryEndpoint: argv.graphNodeQueryEndpoint,
          }
        : undefined,
    })

    logger.info('Connect to network')
    const maxGasFee = argv.baseFeeGasMax || argv.gasPriceMax
    const network = await Network.create(
      logger,
      ethereumProvider,
      contracts,
      wallet,
      indexerAddress,
      argv.publicIndexerUrl,
      argv.indexerGeoCoordinates,
      networkSubgraph,
      argv.restakeRewards,
      argv.rebateClaimThreshold,
      argv.rebateClaimBatchThreshold,
      argv.rebateClaimMaxBatchSize,
      argv.poiDisputeMonitoring,
      argv.poiDisputableEpochs,
      argv.gasIncreaseTimeout,
      argv.gasIncreaseFactor,
      maxGasFee,
      argv.transactionAttempts,
    )
    logger.info('Successfully connected to network', {
      restakeRewards: argv.restakeRewards,
    })

    const receiptCollector = new AllocationReceiptCollector({
      logger,
      transactionManager: network.transactionManager,
      models: queryFeeModels,
      allocationExchange: network.contracts.allocationExchange,
      collectEndpoint: new URL(argv.collectReceiptsEndpoint),
      voucherRedemptionThreshold: argv.voucherRedemptionThreshold,
      voucherRedemptionBatchThreshold: argv.voucherRedemptionBatchThreshold,
      voucherRedemptionMaxBatchSize: argv.voucherRedemptionMaxBatchSize,
    })
    await receiptCollector.queuePendingReceiptsFromDatabase()

    const networkMonitor = new NetworkMonitor(
      contracts,
      toAddress(indexerAddress),
      logger,
      indexingStatusResolver,
      networkSubgraph,
      ethereumProvider,
    )

    logger.info('Launch indexer management API server')
    const indexerManagementClient = await createIndexerManagementClient({
      models: managementModels,
      address: indexerAddress,
      contracts,
      indexingStatusResolver,
      indexNodeIDs: argv.indexNodeIds,
      deploymentManagementEndpoint: argv.graphNodeAdminEndpoint,
      networkSubgraph,
      logger,
      defaults: {
        globalIndexingRule: {
          allocationAmount: argv.defaultAllocationAmount,
          parallelAllocations: 1,
        },
      },
      features: {
        injectDai: argv.injectDai,
      },
      transactionManager: network.transactionManager,
      receiptCollector,
    })

    await createIndexerManagementServer({
      logger,
      client: indexerManagementClient,
      port: argv.indexerManagementPort,
    })
    logger.info(`Successfully launched indexer management API server`)

    const indexer = new Indexer(
      logger,
      argv.graphNodeAdminEndpoint,
      indexingStatusResolver,
      indexerManagementClient,
      argv.indexNodeIds,
      argv.defaultAllocationAmount,
      indexerAddress,
    )
    const networkSubgraphDeployment = argv.networkSubgraphDeployment
      ? new SubgraphDeploymentID(argv.networkSubgraphDeployment)
      : undefined
    if (networkSubgraphDeployment !== undefined) {
      // Make sure the network subgraph is being indexed
      await indexer.ensure(
        `${networkSubgraphDeployment.ipfsHash.slice(
          0,
          23,
        )}/${networkSubgraphDeployment.ipfsHash.slice(23)}`,
        networkSubgraphDeployment,
      )
    }

    // Monitor ETH balance of the operator and write the latest value to a metric
    await monitorEthBalance(logger, wallet, metrics)

    logger.info(`Launch syncing server`)
    await createSyncingServer({
      logger,
      networkSubgraph,
      port: argv.syncingPort,
    })
    logger.info(`Successfully launched syncing server`)

    startCostModelAutomation({
      logger,
      ethereum: ethereumProvider,
      contracts: network.contracts,
      indexerManagement: indexerManagementClient,
      injectDai: argv.injectDai,
      daiContractAddress: toAddress(argv.daiContract),
      metrics,
    })

    await startAgent({
      logger,
      metrics,
      indexer,
      network,
      networkMonitor,
      networkSubgraph,
      allocateOnNetworkSubgraph: argv.allocateOnNetworkSubgraph,
      registerIndexer: argv.register,
      offchainSubgraphs: argv.offchainSubgraphs.map(
        (s: string) => new SubgraphDeploymentID(s),
      ),
      receiptCollector,
      allocationManagementMode:
        AllocationManagementMode[
          argv.allocationManagement.toUpperCase() as keyof typeof AllocationManagementMode
        ],
    })
  },
}
