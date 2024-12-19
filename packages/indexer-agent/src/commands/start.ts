import path from 'path'
import axios from 'axios'
import { Argv } from 'yargs'
import { SequelizeStorage, Umzug } from 'umzug'
import {
  createMetrics,
  connectDatabase,
  createMetricsServer,
  formatGRT,
  Logger,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import {
  createIndexerManagementClient,
  createIndexerManagementServer,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  indexerError,
  IndexerErrorCode,
  MultiNetworks,
  Network,
  Operator,
  registerIndexerErrorMetrics,
  resolveChainId,
  specification as spec,
} from '@graphprotocol/indexer-common'
import { Agent } from '../agent'
import { createSyncingServer } from '../syncing-server'
import { injectCommonStartupOptions } from './common-options'
import pMap from 'p-map'
import { NetworkSpecification } from '@graphprotocol/indexer-common/dist/network-specification'
import { BigNumber } from 'ethers'
import { displayZodParsingError } from '@graphprotocol/indexer-common'
import { readFileSync } from 'fs'
import { AgentConfigs } from '../types'

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
export type AgentOptions = { [key: string]: any } & Argv['argv']

const DEFAULT_SUBGRAPH_MAX_BLOCK_DISTANCE = 0
const SUGGESTED_SUBGRAPH_MAX_BLOCK_DISTANCE_ON_L2 =
  50 + DEFAULT_SUBGRAPH_MAX_BLOCK_DISTANCE
const DEFAULT_SUBGRAPH_FRESHNESS_SLEEP_MILLISECONDS = 5_000

// NOTE: This is run only in single-network mode
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
        coerce: x => x * 10 ** 3,
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
        coerce: x => x * 10 ** 9,
        deprecated: true,
        group: 'Ethereum',
      })
      .option('base-fee-per-gas-max', {
        description:
          'The maximum base fee per gas (gwei) to use for transactions, for legacy transactions this will be treated as the max gas price',
        type: 'number',
        required: false,
        coerce: x => x * 10 ** 9,
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
        nargs: 2,
        default: ['31.780715', '-41.179504'],
        group: 'Indexer Infrastructure',
        coerce: function (
          coordinates: string | [string, string],
        ): [number, number] {
          if (typeof coordinates === 'string') {
            // When this value is set in an enviromnent variable, yarns passes
            // it as a single string.

            // Yargs should have passed 2 arguments to this functions, so we
            // expect this array has two elements
            return coordinates.split(' ').map(parseFloat) as [number, number]
          }
          // When this value is set in the command line, yargs passes it as an
          // array of two strings.
          return coordinates.map(parseFloat) as [number, number]
        },
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
      .option('tap-subgraph-endpoint', {
        description: 'Endpoint to query the tap subgraph from',
        array: false,
        type: 'string',
        group: 'TAP Subgraph',
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
      .option('subgraph-max-block-distance', {
        description:
          'How many blocks subgraphs are allowed to stay behind chain head',
        type: 'number',
        default: DEFAULT_SUBGRAPH_MAX_BLOCK_DISTANCE,
        group: 'Protocol',
      })
      .option('subgraph-freshness-sleep-milliseconds', {
        description:
          'How long to wait before retrying subgraph query if it is not fresh',
        type: 'number',
        default: DEFAULT_SUBGRAPH_FRESHNESS_SLEEP_MILLISECONDS,
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
        default: 1, // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Query Fees',
      })
      .option('rebate-claim-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'number',
        default: 5,
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
        default: 1, // This value (the marginal gain of a claim in GRT), should always exceed the marginal cost of a claim (in ETH gas)
        group: 'Query Fees',
      })
      .option('voucher-redemption-batch-threshold', {
        description: `Minimum total value of all rebates in an batch (in GRT) before the batch is claimed on-chain`,
        type: 'number',
        default: 5,
        group: 'Query Fees',
      })
      .option('voucher-redemption-max-batch-size', {
        description: `Maximum number of rebates inside a batch. Upper bound is constrained by available system memory, and by the block gas limit`,
        type: 'number',
        default: 100,
        group: 'Query Fees',
      })
      .option('address-book', {
        description: 'Graph contracts address book file path',
        type: 'string',
        required: false,
      })
      .option('tap-address-book', {
        description: 'TAP contracts address book file path',
        type: 'string',
        required: false,
      })
      .option('chain-finalize-time', {
        description: 'The time in seconds that the chain finalizes blocks',
        type: 'number',
        default: 3600,
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
      .option('gateway-endpoint', {
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
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  handler: (_argv: any) => {},
}

export async function createNetworkSpecification(
  argv: AgentOptions,
  logger: Logger,
): Promise<spec.NetworkSpecification> {
  const gateway = {
    url: argv.gatewayEndpoint,
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
    allocationManagementMode: argv.allocationManagement,
    autoAllocationMinBatchSize: argv.autoAllocationMinBatchSize,
    allocateOnNetworkSubgraph: argv.allocateOnNetworkSubgraph,
    register: argv.register,
    finalityTime: argv.chainFinalizeTime,
  }

  const transactionMonitoring = {
    gasIncreaseTimeout: argv.gasIncreaseTimeout,
    gasIncreaseFactor: argv.gasIncreaseFactor,
    gasPriceMax: argv.gasPriceMax,
    baseFeePerGasMax: argv.baseFeePerGasMax,
    maxTransactionAttempts: argv.maxTransactionAttempts,
  }

  const subgraphs = {
    maxBlockDistance: argv.subgraphMaxBlockDistance,
    freshnessSleepMilliseconds: argv.subgraphFreshnessSleepMilliseconds,
    networkSubgraph: {
      deployment: argv.networkSubgraphDeployment,
      url: argv.networkSubgraphEndpoint,
    },
    epochSubgraph: {
      // TODO: We should consider indexing the Epoch Subgraph, similar
      // to how we currently do it for the Network Subgraph.
      url: argv.epochSubgraphEndpoint,
    },
    tapSubgraph: {
      url: argv.tapSubgraphEndpoint,
    },
  }

  const networkProvider = {
    url: argv.networkProvider,
    pollingInterval: argv.ethereumPollingInterval,
  }

  // Since we can't infer the network identifier, we must ask the configured
  // JSON RPC provider for its `chainID`.
  const chainId = await fetchChainId(networkProvider.url)
  const networkIdentifier = resolveChainId(chainId)

  // Warn about inappropriate max block distance for subgraph threshold checks for given networks.
  if (networkIdentifier.startsWith('eip155:42161')) {
    // Arbitrum-One and Arbitrum-Goerli
    if (
      subgraphs.maxBlockDistance <= SUGGESTED_SUBGRAPH_MAX_BLOCK_DISTANCE_ON_L2
    ) {
      logger.warn(
        `Consider increasing 'subgraph-max-block-distance' for Arbitrum networks`,
        {
          problem:
            'A low subgraph freshness threshold might cause the Agent to discard too many subgraph queries in fast-paced networks.',
          hint: `Increase the 'subgraph-max-block-distance' parameter to a value that accomodates for block and indexing speeds.`,
          configuredValue: subgraphs.maxBlockDistance,
        },
      )
    }
    if (
      subgraphs.freshnessSleepMilliseconds <=
      DEFAULT_SUBGRAPH_FRESHNESS_SLEEP_MILLISECONDS
    ) {
      logger.warn(
        `Consider increasing 'subgraph-freshness-sleep-milliseconds' for Arbitrum networks`,
        {
          problem:
            'A short subgraph freshness wait time might be insufficient for the subgraph to sync with fast-paced networks.',
          hint: `Increase the 'subgraph-freshness-sleep-milliseconds' parameter to a value that accomodates for block and indexing speeds.`,
          configuredValue: subgraphs.freshnessSleepMilliseconds,
        },
      )
    }
  }

  const tapAddressBook = loadFile(argv.tapAddressBook)

  try {
    return spec.NetworkSpecification.parse({
      networkIdentifier,
      gateway,
      indexerOptions,
      transactionMonitoring,
      subgraphs,
      networkProvider,
      addressBook: argv.addressBook,
      tapAddressBook,
    })
  } catch (parsingError) {
    displayZodParsingError(parsingError)
    process.exit(1)
  }
}

function loadFile(path: string | undefined): unknown | undefined {
  const obj = path ? JSON.parse(readFileSync(path).toString()) : undefined
  return obj
}

export async function run(
  argv: AgentOptions,
  networkSpecifications: spec.NetworkSpecification[],
  logger: Logger,
): Promise<void> {
  // --------------------------------------------------------------------------------
  // * Configure event  listeners for unhandled promise  rejections and uncaught
  // exceptions.
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
  // * Graph Node
  // ---------------------------------------------------------------- ----------------
  const graphNode = new GraphNode(
    logger,
    argv.graphNodeAdminEndpoint,
    argv.graphNodeQueryEndpoint,
    argv.graphNodeStatusEndpoint,
  )

  // --------------------------------------------------------------------------------
  // * Database - Connection
  // --------------------------------------------------------------------------------
  logger.info('Connect to database', {
    host: argv.postgresHost,
    port: argv.postgresPort,
    database: argv.postgresDatabase,
    poolMax: argv.postgresPoolSize,
  })
  const sequelize = await connectDatabase({
    logging: undefined,
    host: argv.postgresHost,
    port: argv.postgresPort,
    username: argv.postgresUsername,
    password: argv.postgresPassword,
    database: argv.postgresDatabase,
    sslEnabled: argv.postgresSslEnabled,
    poolMin: 0,
    poolMax: argv.postgresPoolSize,
  })
  logger.info('Successfully connected to database')

  // --------------------------------------------------------------------------------
  // * Database - Migrations
  // --------------------------------------------------------------------------------
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
        graphNodeAdminEndpoint: argv.graphNodeAdminEndpoint,
        networkSpecifications,
        graphNode: graphNode,
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
  // * Networks
  // --------------------------------------------------------------------------------
  logger.info('Connect to network/s', {
    networks: networkSpecifications.map(spec => spec.networkIdentifier),
  })

  const networks: Network[] = await pMap(
    networkSpecifications,
    async (spec: NetworkSpecification) =>
      Network.create(logger, spec, queryFeeModels, graphNode, metrics),
  )

  // --------------------------------------------------------------------------------
  // * Indexer Management (GraphQL) Server
  // --------------------------------------------------------------------------------
  const multiNetworks = new MultiNetworks(
    networks,
    (n: Network) => n.specification.networkIdentifier,
  )

  const indexerManagementClient = await createIndexerManagementClient({
    models: managementModels,
    graphNode,
    logger,
    defaults: {
      globalIndexingRule: {
        // TODO: Update this, there will be defaults per network
        allocationAmount: BigNumber.from(100),
        parallelAllocations: 1,
      },
    },
    multiNetworks,
  })

  // --------------------------------------------------------------------------------
  // * Indexer Management Server
  // --------------------------------------------------------------------------------
  logger.info('Launch indexer management API server', {
    port: argv.indexerManagementPort,
  })
  await createIndexerManagementServer({
    logger,
    client: indexerManagementClient,
    port: argv.indexerManagementPort,
  })
  logger.info(`Successfully launched indexer management API server`)

  // --------------------------------------------------------------------------------
  // * Syncing Server
  // --------------------------------------------------------------------------------
  logger.info(`Launch syncing server`)

  await createSyncingServer({
    logger,
    networkSubgraphs: await multiNetworks.map(
      async network => network.networkSubgraph,
    ),
    port: argv.syncingPort,
  })
  logger.info(`Successfully launched syncing server`)

  // --------------------------------------------------------------------------------
  // * Operator
  // --------------------------------------------------------------------------------
  const operators: Operator[] = await pMap(
    networkSpecifications,
    async (spec: NetworkSpecification) =>
      new Operator(logger, indexerManagementClient, spec),
  )

  // --------------------------------------------------------------------------------
  // * The Agent itself
  // --------------------------------------------------------------------------------
  const agentConfigs: AgentConfigs = {
    logger,
    metrics,
    graphNode,
    operators,
    indexerManagement: indexerManagementClient,
    networks,
    deploymentManagement: argv.deploymentManagement,
    autoMigrationSupport: argv.enableAutoMigrationSupport,
    offchainSubgraphs: argv.offchainSubgraphs.map(
      (s: string) => new SubgraphDeploymentID(s),
    ),
    pollingInterval: argv.pollingInterval,
  }
  const agent = new Agent(agentConfigs)
  await agent.start()
}

// Review CLI arguments, emit non-interrupting warnings about expected behavior.
// Perform this check immediately after parsing the command line arguments.
// Ideally, this check could be made inside yargs.check, but we can't access a Logger
// instance in that context.
export function reviewArgumentsForWarnings(argv: AgentOptions, logger: Logger) {
  const {
    gasIncreaseTimeout,
    gasIncreaseFactor,
    rebateClaimThreshold,
    voucherRedemptionThreshold,
    rebateClaimMaxBatchSize,
    voucherRedemptionMaxBatchSize,
    collectReceiptsEndpoint,
  } = argv

  logger.debug('Reviewing Indexer Agent configuration')

  const advisedGasIncreaseTimeout = 90000
  const advisedGasIncreaseFactor = 1.5
  const advisedRebateClaimMaxBatchSize = 200
  const advisedVoucherRedemptionMaxBatchSize = 200

  if (collectReceiptsEndpoint) {
    logger.warn(
      "The option '--collect-receipts-endpoint' is deprecated. " +
        "Please use the option '--gateway-endpoint' to inform the Gateway base URL.",
    )
  }

  if (gasIncreaseTimeout < advisedGasIncreaseTimeout) {
    logger.warn(
      `Gas increase timeout is set to less than ${
        advisedGasIncreaseTimeout / 1000
      } seconds. This may lead to high gas usage`,
      { gasIncreaseTimeout: gasIncreaseTimeout },
    )
  }

  if (gasIncreaseFactor > advisedGasIncreaseFactor) {
    logger.warn(
      `Gas increase factor is set to > ${advisedGasIncreaseFactor}. ` +
        'This may lead to high gas usage',
      { gasIncreaseFactor: gasIncreaseFactor },
    )
  }
  if (rebateClaimThreshold < voucherRedemptionThreshold) {
    logger.warn(
      'Rebate single minimum claim value is less than voucher minimum redemption value, ' +
        'but claims depend on redemptions',
      {
        voucherRedemptionThreshold: formatGRT(voucherRedemptionThreshold),
        rebateClaimThreshold: formatGRT(rebateClaimThreshold),
      },
    )
  }

  if (rebateClaimThreshold === 0) {
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

  if (voucherRedemptionThreshold == 0) {
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

// Retrieves the network identifier in contexts where we haven't yet instantiated the JSON
// RPC Provider, which has additional and more complex dependencies.
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
