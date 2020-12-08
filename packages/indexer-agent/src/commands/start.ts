import path from 'path'

import { Argv } from 'yargs'
import { createClient } from '@urql/core'
import { Umzug, SequelizeStorage } from 'umzug'
import {
  createLogger,
  SubgraphDeploymentID,
  connectDatabase,
  parseGRT,
  createMetrics,
  createMetricsServer,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  createIndexerManagementServer,
  createIndexerManagementClient,
  indexerError,
  IndexerErrorCode,
  registerIndexerErrorMetrics,
} from '@graphprotocol/indexer-common'

import { startAgent } from '../agent'
import { Network } from '../network'
import { providers } from 'ethers'
import { startCostModelAutomation } from '../cost'

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
        description: 'Ethereum network ',
        type: 'string',
        required: false,
        default: 'rinkeby',
        group: 'Ethereum',
      })
      .option('ethereum-polling-interval', {
        description: 'Polling interval for the Ethereum provider (ms)',
        type: 'number',
        default: 4000,
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
        conflicts: 'network-subgraph-deployment',
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
      .option('restake-rewards', {
        description: `Restake claimed indexer rewards, if set to 'false' rewards will be returned to the wallet`,
        type: 'boolean',
        default: true,
        group: 'Indexer Infrastructure',
      })
      .option('inject-dai', {
        description:
          'Inject the GRT per DAI conversion rate into cost model variables',
        type: 'boolean',
        default: true,
        group: 'Cost Models',
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
      .check(argv => {
        if (
          !argv['network-subgraph-endpoint'] &&
          !argv['network-subgraph-deployment']
        ) {
          return `One of --network-subgraph-endpoint and --network-subgraph-deployment must be provided`
        }
        if (argv['indexer-geo-coordinates']) {
          const [geo1, geo2] = argv['indexer-geo-coordinates']
          if (!+geo1 || !+geo2) {
            return 'Invalid --indexer-geo-coordinates provided. Must be of format e.g.: 31.780715 -41.179504'
          }
        }
        return true
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
    const models = defineIndexerManagementModels(sequelize)
    await sequelize.sync()
    logger.info('Successfully connected to database')

    // Automatic database migrations
    logger.info(`Run database migrations`)
    try {
      const umzug = new Umzug({
        migrations: { glob: path.join(__dirname, '..', 'migrations', '*.js') },
        context: {
          queryInterface: sequelize.getQueryInterface(),
          logger,
        },
        storage: new SequelizeStorage({ sequelize }),
        logger,
      })
      await umzug.up()
    } catch (err) {
      logger.fatal(`Failed to run database migrations`, {
        err: indexerError(IndexerErrorCode.IE001, err),
      })
      process.exit(1)
      return
    }
    logger.info(`Successfully ran database migrations`)

    logger.info(`Connect to Ethereum`)
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

    const ethereum = new providers.StaticJsonRpcProvider(
      {
        url: providerUrl.toString(),
        user: providerUrl.username,
        password: providerUrl.password,
        allowInsecureAuthentication: true,
      },
      argv.ethereumNetwork,
    )
    ethereum.pollingInterval = argv.ethereumPollingInterval

    ethereum.on('debug', info => {
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

    ethereum.on('network', (newNetwork, oldNetwork) => {
      logger.trace('Ethereum network change', {
        oldNetwork: oldNetwork,
        newNetwork: newNetwork,
      })
    })

    logger.info(`Connected to Ethereum`, {
      pollingInterval: ethereum.pollingInterval,
      network: await ethereum.detectNetwork(),
    })

    logger.info('Connect to network')
    const networkSubgraph = argv.networkSubgraphEndpoint
      ? createClient({
          url: argv.networkSubgraphEndpoint,
          requestPolicy: 'network-only',
        })
      : new SubgraphDeploymentID(argv.networkSubgraphDeployment)
    const network = await Network.create(
      logger,
      ethereum,
      argv.mnemonic,
      toAddress(argv.indexerAddress),
      argv.publicIndexerUrl,
      argv.graphNodeQueryEndpoint,
      argv.indexerGeoCoordinates,
      networkSubgraph,
      argv.restakeRewards,
    )
    logger.info('Successfully connected to network', {
      restakeRewards: argv.restakeRewards,
    })

    logger.info('Launch indexer management API server')
    const indexerManagementClient = await createIndexerManagementClient({
      models,
      address: toAddress(network.indexerAddress),
      contracts: network.contracts,
      logger,
      defaults: {
        globalIndexingRule: {
          allocationAmount: parseGRT(argv.defaultAllocationAmount),
          parallelAllocations: 2,
        },
      },
      features: {
        injectDai: argv.injectDai,
      },
    })
    await createIndexerManagementServer({
      logger,
      client: indexerManagementClient,
      port: argv.indexerManagementPort,
    })
    logger.info(`Launched indexer management API server`)

    startCostModelAutomation({
      logger,
      ethereum,
      contracts: network.contracts,
      indexerManagement: indexerManagementClient,
      injectDai: argv.injectDai,
      metrics,
    })

    await startAgent({
      ethereum,
      adminEndpoint: argv.graphNodeAdminEndpoint,
      statusEndpoint: argv.graphNodeStatusEndpoint,
      logger,
      indexNodeIDs: argv.indexNodeIds,
      network,
      networkSubgraph,
      indexerManagement: indexerManagementClient,
      defaultAllocationAmount: parseGRT(argv.defaultAllocationAmount),
    })
  },
}
