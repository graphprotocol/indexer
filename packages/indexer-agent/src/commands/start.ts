import path from 'path'
import axios from 'axios'
import { Argv } from 'yargs'
import { SequelizeStorage, Umzug } from 'umzug'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  createMetricsServer,
  formatGRT,
  Logger,
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
  AllocationManagementMode,
  resolveChainId,
  validateNetworkId,
  specification as spec,
} from '@graphprotocol/indexer-common'
import { Agent } from '../agent'
import { Indexer } from '../indexer'
import { startCostModelAutomation } from '../cost'
import { createSyncingServer } from '../syncing-server'
import { monitorEthBalance } from '../utils'
import { injectCommonStartupOptions } from './common-options'

export type AgentOptions = { [key: string]: any } & Argv['argv']

export const start = {
  command: 'start',
  describe: 'Start the agent',
  builder: (args: Argv): Argv => {
    const updatedArgs = injectCommonStartupOptions(args)
    return updatedArgs
      .option('network-provider', {
        alias: 'ethereum',
        description: 'Ethereum node or provider URL',
        array: false,
        type: 'string',
        required: true,
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
      })
      .option('base-fee-per-gas-max', {
        description:
          'The maximum base fee per gas (gwei) to use for transactions, for legacy transactions this will be treated as the max gas price',
        type: 'number',
        required: false,
        group: 'Ethereum',
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
        coerce: coordinates => coordinates.map(parseFloat),
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        array: false,
        type: 'string',
        group: 'Network Subgraph',
      })
      .option('network-subgraph-endpoint', {
        description: 'Endpoint to query the network subgraph from',
        array: false,
        type: 'string',
        group: 'Network Subgraph',
      })
      .option('allocate-on-network-subgraph', {
        description: 'Whether to allocate to the network subgraph',
        type: 'boolean',
        default: false,
        group: 'Network Subgraph',
      })
      .option('epoch-subgraph-endpoint', {
        description: 'Endpoint to query the epoch block oracle subgraph from',
        array: false,
        type: 'string',
        required: true,
        group: 'Protocol',
      })
      .option('default-allocation-amount', {
        description:
          'Default amount of GRT to allocate to a subgraph deployment',
        type: 'number',
        default: 0.01,
        required: false,
        group: 'Protocol',
      })
      .option('restake-rewards', {
        description: `Restake claimed indexer rewards, if set to 'false' rewards will be returned to the wallet`,
        type: 'boolean',
        default: true,
        group: 'Indexer Infrastructure',
      })
      .option('rebate-claim-threshold', {
        description: `Minimum value of rebate for a single allocation (in GRT) in order for it to be included in a batch rebate claim on-chain`,
        type: 'number',
        default: 200, // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Query Fees',
      })
      .option('rebate-claim-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'number',
        default: 2000,
        group: 'Query Fees',
      })
      .option('rebate-claim-max-batch-size', {
        description: `Maximum number of rebates inside a batch. Upper bound is constrained by available system memory, and by the block gas limit`,
        type: 'number',
        default: 100,
        group: 'Query Fees',
      })
      .option('voucher-redemption-threshold', {
        description: `Minimum value of rebate for a single allocation (in GRT) in order for it to be included in a batch rebate claim on-chain`,
        type: 'number',
        default: 200, // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Query Fees',
      })
      .option('voucher-redemption-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'number',
        default: 2000,
        group: 'Query Fees',
      })
      .option('voucher-redemption-max-batch-size', {
        description: `Maximum number of rebates inside a batch. Upper bound is constrained by available system memory, and by the block gas limit`,
        type: 'number',
        default: 100,
        group: 'Query Fees',
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
      .option('register', {
        description: 'Whether to register the indexer on chain',
        type: 'boolean',
        default: true,
        group: 'Protocol',
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
      .option('gateway-endopoint', {
        description: 'Gateway endpoint base URL',
        alias: 'collect-receipts-endpoint',
        type: 'string',
        array: false,
        required: true,
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
      .option('auto-allocation-min-batch-size', {
        description: `Minimum number of allocation transactions inside a batch for auto allocation management. No obvious upperbound, with default of 1`,
        type: 'number',
        default: 1,
        group: 'Indexer Infrastructure',
      })
      .check(argv => {
        if (
          !argv['network-subgraph-endpoint'] &&
          !argv['network-subgraph-deployment']
        ) {
          return 'At least one of --network-subgraph-endpoint and --network-subgraph-deployment must be provided'
        }
        if (argv['indexer-geo-coordinates']) {
          const [geo1, geo2] = argv['indexer-geo-coordinates']
          if (!+geo1 || !+geo2) {
            return 'Invalid --indexer-geo-coordinates provided. Must be of format e.g.: 31.780715 -41.179504'
          }
        }
        if (argv['gas-increase-timeout']) {
          if (argv['gas-increase-timeout'] < 30) {
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
  },
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: (_argv: any) => {},
}

export async function createNetworkSpecification(
  argv: AgentOptions,
): Promise<spec.NetworkSpecification> {
  const gateway = {
    baseUrl: argv.gatewayEndpoint,
  }

  const indexerOptions = {
    address: argv.indexerAddress,
    mnemonic: argv.mnemonic,
    url: argv.publicIndexerUrl,
    geoCoordinates: argv.indexerGeoCoordinates,
    restakeRewards: argv.restakeRewards,
    rebateClaimThreshold: argv.rebateClaimThreshold,
    rebateClaimBatchThreshold: argv.rebateClaimBatchThreshold,
    rebateClaimMaxBatchSize: argv.rebateClaimMaxBatchSize,
    poiDisputeMonitoring: argv.poiDisputeMonitoring,
    poiDisputableEpochs: argv.poiDisputableEpochs,
    defaultAllocationAmount: argv.defaultAllocationAmount,
    voucherRedemptionThreshold: argv.voucherRedemptionThreshold,
    voucherRedemptionBatchThreshold: argv.voucherRedemptionBatchThreshold,
    voucherRedemptionMaxBatchSize: argv.voucherRedemptionMaxBatchSize,
    allocationManagementMode: argv.allocationManagementMode,
    autoAllocationMinBatchSize: argv.autoAllocationMinBatchSize,
  }

  const transactionMonitoring = {
    gasIncreaseTimeout: argv.gasIncreaseTimeout,
    gasIncreaseFactor: argv.gasIncreaseFactor,
    baseFeePerGasMax: argv.baseFeeGasMax,
    maxTransactionAttempts: argv.maxTransactionAttempts,
  }

  const subgraphs = {
    networkSubgraph: {
      deployment: argv.networkSubgraphDeployment,
      url: argv.networkSubgraphEndpoint,
    },
    epochSubgraph: {
      // TODO: We should consider indexing the Epoch Subgraph, similar
      // to how we currently do it for the Network Subgraph.
      url: argv.epochSubgraphEndpoint,
    },
  }

  const dai = {
    contractAddress: argv.daiContractAddress,
    injectDai: argv.injectDai,
  }

  const networkProvider = {
    url: argv.networkProvider,
  }

  // TODO: We can't infer the network identifier, so we must ask the
  // configured JSON RPC provider for its `chainID`.
  const chainId = await fetchChainId(networkProvider.url)
  const networkIdentifier = resolveChainId(chainId)

  return spec.NetworkSpecification.parse({
    networkIdentifier,
    gateway,
    indexerOptions,
    transactionMonitoring,
    subgraphs,
    networkProvider,
    dai,
  })
}

// TODO: Split this code into two functions:
// 1. [X] Create NetworkSpecification
// 2. [ ] Start Agent with NetworkSpecification as input.
async function _oldHandler(
  argv: AgentOptions,
  networkSpecification: spec.NetworkSpecification,
): Promise<void> {
  const logger = createLogger({
    name: 'IndexerAgent',
    async: false,
    level: argv.logLevel,
  })
  // --------------------------------------------------------------------------------
  // * CLI Argument review
  //
  // Note: it only lives here and not on yargs.check because we don't have a
  // logger in that context
  // --------------------------------------------------------------------------------
  reviewArgumentsForWarnings(argv, logger)

  // --------------------------------------------------------------------------------
  // * NodeJS process stuff
  // --------------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------------
  // * Metrics Server
  // --------------------------------------------------------------------------------
  /* Currently in use by:
   - Network Provider
   - Network
   - Allocation Receipt Collector
   - ETH Balance Monitor
   - Cost Model Automation
   - The Agent itself
  */
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

  // --------------------------------------------------------------------------------
  // * Indexing Status Resolver (part of the upcoming GraphNode class)
  // --------------------------------------------------------------------------------
  const indexingStatusResolver = new IndexingStatusResolver({
    logger: logger,
    statusEndpoint: argv.graphNodeStatusEndpoint,
  })

  // --------------------------------------------------------------------------------
  // * NetworkSubgraph
  // --------------------------------------------------------------------------------
  // Parse the Network Subgraph optional argument
  const networkSubgraphDeploymentId = argv.networkSubgraphDeployment
    ? new SubgraphDeploymentID(argv.networkSubgraphDeployment)
    : undefined

  const networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint: argv.networkSubgraphEndpoint,
    deployment:
      networkSubgraphDeploymentId !== undefined
        ? {
            indexingStatusResolver: indexingStatusResolver,
            deployment: networkSubgraphDeploymentId,
            graphNodeQueryEndpoint: argv.graphNodeQueryEndpoint,
          }
        : undefined,
  })

  // --------------------------------------------------------------------------------
  // * NetworkProvider and NetworkIdentifier
  // --------------------------------------------------------------------------------
  const networkProvider = await Network.provider(
    logger,
    metrics,
    argv.networkProvider,
    argv.ethereumPollingInterval,
  )
  const networkMeta = await networkProvider.getNetwork()
  const networkChainId = resolveChainId(networkMeta.chainId)

  // --------------------------------------------------------------------------------
  // * Network
  // --------------------------------------------------------------------------------

  logger.info('Connect to network')

  const network = await Network.create(
    logger,
    networkSpecification,
    argv.graphNodeQueryEndpoint,
    argv.graphNodeStatusEndpoint,
    metrics,
  )
  logger.info('Successfully connected to network', {
    restakeRewards: argv.restakeRewards,
  })

  // --------------------------------------------------------------------------------
  // * Database - Connection
  // --------------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------------
  // * Database - Migrations
  // --------------------------------------------------------------------------------

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
        indexingStatusResolver,
        graphNodeAdminEndpoint: argv.graphNodeAdminEndpoint,
        networkMonitor: network.networkMonitor,
        networkChainId,
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
  }
  logger.info(`Successfully ran database migrations`)

  // --------------------------------------------------------------------------------
  // * Database - Sync Models
  // --------------------------------------------------------------------------------

  logger.info(`Sync database models`)
  const managementModels = defineIndexerManagementModels(sequelize)
  const queryFeeModels = defineQueryFeeModels(sequelize)
  await sequelize.sync()
  logger.info(`Successfully synced database models`)

  // --------------------------------------------------------------------------------
  // * Allocation Receipt Collector
  // --------------------------------------------------------------------------------

  const receiptCollector = new AllocationReceiptCollector({
    logger,
    metrics,
    transactionManager: network.transactionManager,
    models: queryFeeModels,
    allocationExchange: network.contracts.allocationExchange,
    gatewayEndpoint: argv.gatewayEndpoint,
    voucherRedemptionThreshold: argv.voucherRedemptionThreshold,
    voucherRedemptionBatchThreshold: argv.voucherRedemptionBatchThreshold,
    voucherRedemptionMaxBatchSize: argv.voucherRedemptionMaxBatchSize,
  })
  await receiptCollector.queuePendingReceiptsFromDatabase()

  // --------------------------------------------------------------------------------
  // * Indexer Management (GraphQL) Server
  // --------------------------------------------------------------------------------

  logger.info('Launch indexer management API server')
  const allocationManagementMode =
    AllocationManagementMode[
      argv.allocationManagement.toUpperCase() as keyof typeof AllocationManagementMode
    ]

  // * Indexer Management Client
  const indexerManagementClient = await createIndexerManagementClient({
    models: managementModels,
    address: networkSpecification.indexerOptions.address,
    contracts: network.contracts,
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
    networkMonitor: network.networkMonitor,
    allocationManagementMode,
    autoAllocationMinBatchSize: argv.autoAllocationMinBatchSize,
  })

  // * Indexer Management Server
  await createIndexerManagementServer({
    logger,
    client: indexerManagementClient,
    port: argv.indexerManagementPort,
  })
  logger.info(`Successfully launched indexer management API server`)

  // --------------------------------------------------------------------------------
  // * Indexer
  // TODO: rename & refactor it to be a Graph-Node class)
  // --------------------------------------------------------------------------------

  const indexer = new Indexer(
    logger,
    argv.graphNodeAdminEndpoint,
    indexingStatusResolver,
    indexerManagementClient,
    argv.indexNodeIds,
    argv.defaultAllocationAmount,
    networkSpecification.indexerOptions.address,
    allocationManagementMode,
  )

  // * Index the Network Subgraph

  if (networkSubgraphDeploymentId !== undefined) {
    // Make sure the network subgraph is being indexed
    await indexer.ensure(
      `indexer-agent/${networkSubgraphDeploymentId.ipfsHash.slice(-10)}`,
      networkSubgraphDeploymentId,
    )

    // Validate if the Network Subgraph belongs to the current provider's network.
    // This check must be performed after we ensure the Network Subgraph is being indexed.
    try {
      await validateNetworkId(
        networkMeta,
        argv.networkSubgraphDeployment,
        indexingStatusResolver,
        logger,
      )
    } catch (e) {
      logger.critical('Failed to validate Network Subgraph. Exiting.', e)
      process.exit(1)
    }
  }

  // --------------------------------------------------------------------------------
  // * ETH Balance Monitor
  // --------------------------------------------------------------------------------
  // Monitor ETH balance of the operator and write the latest value to a metric
  await monitorEthBalance(logger, network.wallet, metrics)

  // --------------------------------------------------------------------------------
  // * Syncing Server
  // --------------------------------------------------------------------------------
  logger.info(`Launch syncing server`)
  await createSyncingServer({
    logger,
    networkSubgraph,
    port: argv.syncingPort,
  })
  logger.info(`Successfully launched syncing server`)

  // --------------------------------------------------------------------------------
  // * Cost Model Automation
  // --------------------------------------------------------------------------------

  startCostModelAutomation({
    logger,
    ethereum: networkProvider,
    contracts: network.contracts,
    indexerManagement: indexerManagementClient,
    injectDai: argv.injectDai,
    daiContractAddress: toAddress(argv.daiContract),
    metrics,
  })

  // --------------------------------------------------------------------------------
  // * The Agent itself
  // --------------------------------------------------------------------------------
  const agent = new Agent(
    logger,
    metrics,
    indexer,
    network,
    networkSubgraph,
    argv.offchainSubgraphs.map((s: string) => new SubgraphDeploymentID(s)),
    receiptCollector,
  )
  await agent.start()
}

// Review CLI arguments, emit non-interrupting warnings about expected behavior.
// Perform this check immediately after parsing the command line arguments.
function reviewArgumentsForWarnings(argv: AgentOptions, logger: Logger) {
  const {
    gasIncreaseTimeout,
    gasIncreaseFactor,
    rebateClaimThreshold,
    voucherRedemptionThreshold,
    rebateClaimMaxBatchSize,
    voucherRedemptionMaxBatchSize,
    collectReceiptsEndpoint,
  } = argv

  const advisedGasIncreaseTimeout = 90000
  const advisedGasIncreaseFactor = 1.5
  const advisedRebateClaimMaxBatchSize = 200
  const advisedVoucherRedemptionMaxBatchSize = 200

  if (collectReceiptsEndpoint) {
    logger.warn(
      "The option '--collect-receipts-endpoint' is depracated. " +
        "Please use the option '--gateway-endpoint' to inform the Gatway base URL.",
    )
  }

  if (gasIncreaseTimeout < advisedGasIncreaseTimeout) {
    logger.warn(
      `Gas increase timeout is set to less than ${
        gasIncreaseTimeout / 1000
      } seconds. This may lead to high gas usage`,
      { gasIncreaseTimeout: gasIncreaseTimeout / 1000.0 },
    )
  }

  if (gasIncreaseFactor > advisedGasIncreaseTimeout) {
    logger.warn(
      `Gas increase factor is set to > ${advisedGasIncreaseFactor}. ` +
        'This may lead to high gas usage',
      { gasIncreaseFactor: gasIncreaseFactor },
    )
  }

  if (rebateClaimThreshold.lt(voucherRedemptionThreshold)) {
    logger.warn(
      'Rebate single minimum claim value is less than voucher minimum redemption value, ' +
        'but claims depend on redemptions',
      {
        voucherRedemptionThreshold: formatGRT(voucherRedemptionThreshold),
        rebateClaimThreshold: formatGRT(rebateClaimThreshold),
      },
    )
  }

  if (rebateClaimThreshold.eq(0)) {
    logger.warn(
      `Minimum query fee rebate value is 0 GRT, which may lead to claiming unprofitable rebates`,
    )
  }

  if (rebateClaimMaxBatchSize > advisedRebateClaimMaxBatchSize) {
    logger.warn(
      `Setting the max batch size for rebate claims to more than ${advisedRebateClaimMaxBatchSize}` +
        'may result in batches that are too large to fit into a block',
      { rebateClaimMaxBatchSize: rebateClaimMaxBatchSize },
    )
  }

  if (voucherRedemptionThreshold.eq(0)) {
    logger.warn(
      `Minimum voucher redemption value is 0 GRT, which may lead to redeeming unprofitable vouchers`,
    )
  }

  if (voucherRedemptionMaxBatchSize > advisedVoucherRedemptionMaxBatchSize) {
    logger.warn(
      `Setting the max batch size for voucher redemptions to more than ${advisedVoucherRedemptionMaxBatchSize} ` +
        'may result in batches that are too large to fit into a block',
      { voucherRedemptionMaxBatchSize: voucherRedemptionMaxBatchSize },
    )
  }
}

async function fetchChainId(url: string): Promise<number> {
  const payload = {
    jsonrpc: '2.0',
    id: 0,
    method: 'eth_chainId',
  }
  try {
    const response = await axios.post(url, payload)
    if (response.status !== 200) {
      throw `HTTP ${response.status}`
    }
    if (!response.data || !response.data.result) {
      throw `Received invalid response body from provider: ${response.data}`
    }
    return parseInt(response.data.result, 16)
  } catch (error) {
    throw new Error(`Failed to fetch chainID from provider: ${error}`)
  }
}
