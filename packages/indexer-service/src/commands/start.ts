import path from 'path'
import readPackage from 'read-pkg'
import { Argv } from 'yargs'
import { BigNumber, Wallet } from 'ethers'
import fs from 'fs'
import { parse as yaml_parse } from 'yaml'

import {
  AddressBook,
  connectContracts,
  connectDatabase,
  createLogger,
  createMetrics,
  createMetricsServer,
  NetworkContracts,
  SubgraphDeploymentID,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  indexerError,
  IndexerErrorCode,
  GraphNode,
  monitorEligibleAllocations,
  Network,
  NetworkSubgraph,
  registerIndexerErrorMetrics,
  resolveChainId,
  validateProviderNetworkIdentifier,
} from '@graphprotocol/indexer-common'

import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { ensureAttestationSigners } from '../allocations'
import { AllocationReceiptManager } from '../query-fees'
import pRetry from 'p-retry'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv): Argv => {
    return yargs
      .option('network-provider', {
        alias: 'ethereum',
        description: 'Ethereum node or provider URL',
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
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        group: 'Network Subgraph',
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
      .option('query-timing-logs', {
        description: 'Log time spent on each query received',
        type: 'boolean',
        default: false,
        required: false,
        group: 'Indexer Infrastructure',
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
      .option('address-book', {
        description: 'Graph contracts address book file path',
        type: 'string',
        required: false,
      })
      .option('info-rate-limit', {
        description:
          'Max requests per minute before returning 429 status codes, applies to paths: /cost, /subgraphs/health, /operator',
        type: 'number',
        required: false,
        default: 300,
        group: 'Server options',
      })
      .option('status-rate-limit', {
        description:
          'Max requests per minute before returning 429 status codes, applies to paths: /status, /network',
        type: 'number',
        required: false,
        default: 300,
        group: 'Server options',
      })
      .option('body-size-limit', {
        description: 'Max body size per request (mb)',
        type: 'number',
        required: false,
        default: 0.1,
        group: 'Server options',
      })

      .check(argv => {
        if (!argv['network-subgraph-endpoint'] && !argv['network-subgraph-deployment']) {
          return `At least one of --network-subgraph-endpoint and --network-subgraph-deployment must be provided`
        }

        return true
      })
      .config({
        key: 'config-file',
        description: 'Indexer service configuration file (YAML format)',
        parseFn: function (cfgFilePath: string) {
          return yaml_parse(fs.readFileSync(cfgFilePath, 'utf-8'))
        },
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

    logger.info(`Connect to network subgraph`)
    const graphNode = new GraphNode(
      logger,
      // We use a fake Graph Node admin endpoint here because we don't
      // want the Indexer Service to perform management actions on
      // Graph Node.
      'http://fake-graph-node-admin-endpoint',
      argv.graphNodeQueryEndpoint,
      argv.graphNodeStatusEndpoint,
      argv.indexNodeIds,
    )

    const networkProvider = await Network.provider(
      logger,
      metrics,
      '_',
      argv.networkProvider,
      argv.ethereumPollingInterval,
    )
    const networkIdentifier = await networkProvider.getNetwork()
    const protocolNetwork = resolveChainId(networkIdentifier.chainId)

    const networkSubgraph = await NetworkSubgraph.create({
      logger,
      endpoint: argv.networkSubgraphEndpoint,
      deployment: argv.networkSubgraphDeployment
        ? {
            graphNode,
            deployment: new SubgraphDeploymentID(argv.networkSubgraphDeployment),
          }
        : undefined,
    })
    logger.info(`Successfully connected to network subgraph`)

    // If the network subgraph deployment is present, validate if the `chainId` we get from our
    // provider is consistent.
    if (argv.networkSubgraphDeployment) {
      try {
        await validateProviderNetworkIdentifier(
          protocolNetwork,
          argv.networkSubgraphDeployment,
          graphNode,
          logger,
        )
      } catch (e) {
        logger.warn(
          'Failed to validate Network Subgraph on index-nodes. Will use external subgraph endpoint instead',
        )
      }
    }

    logger.info('Connect to contracts', {
      network: networkIdentifier.name,
      chainId: networkIdentifier.chainId,
    })

    let contracts: NetworkContracts | undefined = undefined
    try {
      const addressBook = argv.addressBook
        ? (JSON.parse(fs.readFileSync(argv.addressBook).toString()) as AddressBook)
        : undefined
      contracts = await connectContracts(
        networkProvider,
        networkIdentifier.chainId,
        addressBook,
      )
    } catch (error) {
      logger.error(
        `Failed to connect to contracts, please ensure you are using the intended Ethereum Network`,
      )
      throw indexerError(IndexerErrorCode.IE075, error)
    }

    logger.info('Successfully connected to contracts', {
      curation: contracts.curation.address,
      disputeManager: contracts.disputeManager.address,
      epochManager: contracts.epochManager.address,
      gns: contracts.gns.address,
      rewardsManager: contracts.rewardsManager.address,
      serviceRegistry: contracts.serviceRegistry.address,
      staking: contracts.staking.address,
      token: contracts.token.address,
    })

    const receiptManager = new AllocationReceiptManager(
      sequelize,
      queryFeeModels,
      logger,
      toAddress(argv.clientSignerAddress),
      protocolNetwork,
    )

    // Ensure the address is checksummed
    const operatorAddress = toAddress(wallet.address)

    logger = logger.child({
      indexer: indexerAddress.toString(),
      operator: operatorAddress.toString(),
    })

    logger.info('Validating operator wallet is approved to take actions for indexer')
    // Validate the operator wallet matches the operator set for the indexer
    if (indexerAddress === operatorAddress) {
      logger.info(`Indexer and operator are identical, operator status granted`)
    } else {
      const isOperator = await pRetry(
        async () =>
          contracts!.staking.isOperator(
            wallet.address.toString(),
            indexerAddress.toString(),
          ),
        {
          retries: 10,
          maxTimeout: 10000,
          onFailedAttempt: err => {
            logger.warn(
              `contracts.staking.isOperator(${wallet.address.toString()}, ${indexerAddress.toString()}) failed`,
              {
                attempt: err.attemptNumber,
                retriesLeft: err.retriesLeft,
                err: err.message,
              },
            )
          },
        } as pRetry.Options,
      )

      if (isOperator == false) {
        logger.error(
          'Operator wallet is not allowed for indexer, please see attached debug suggestions',
          {
            debugSuggestion1: 'verify that operator wallet is set for indexer account',
            debugSuggestion2:
              'verify that service and agent are both using correct operator wallet mnemonic',
          },
        )
        throw indexerError(
          IndexerErrorCode.IE034,
          `contracts.staking.isOperator returned 'False'`,
        )
      }
    }

    // Monitor indexer allocations that we may receive traffic for
    const allocations = monitorEligibleAllocations({
      indexer: indexerAddress,
      logger,
      networkSubgraph,
      protocolNetwork,
      interval: argv.allocationSyncingInterval,
    })

    // Ensure there is an attestation signer for every allocation
    const signers = ensureAttestationSigners({
      logger,
      allocations,
      wallet,
      chainId: networkIdentifier.chainId,
      disputeManagerAddress: contracts.disputeManager.address,
    })

    // Create a query processor for paid queries
    const queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      receiptManager,
      signers,
      queryTimingLogs: argv.queryTimingLogs,
    })

    const indexerManagementClient = await createIndexerManagementClient({
      models,
      graphNode,
      indexNodeIDs: ['node_1'], // This is just a dummy since the indexer-service doesn't manage deployments,
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
      infoRateLimit: argv.infoRateLimit,
      statusRateLimit: argv.statusRateLimit,
      bodySizeLimit: argv.bodySizeLimit,
    })
  },
}
