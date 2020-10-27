import { Argv } from 'yargs'
import { createClient } from '@urql/core'
import {
  createLogger,
  SubgraphDeploymentID,
  connectDatabase,
  parseGRT,
} from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  createIndexerManagementServer,
  createIndexerManagementClient,
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
        description: 'Node IDs of Graph nodes to use for indexing',
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
      .option('inject-dai-grt-conversion-rate', {
        description:
          'Whether to inject the DAI/GRT conversion rate into cost model variables',
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
    const logger = createLogger({ name: 'IndexerAgent', async: false })

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

    logger.info(`Connect to Ethereum`)
    let providerUrl
    try {
      providerUrl = new URL(argv.ethereum)
    } catch (e) {
      throw new Error(`Invalid Ethereum URL '${argv.ethereum}': ${e}`)
    }
    const ethereum = new providers.JsonRpcProvider({
      url: providerUrl.toString(),
      user: providerUrl.username,
      password: providerUrl.password,
    })
    logger.info(`Connected to Ethereum`)

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
      argv.indexerAddress,
      argv.publicIndexerUrl,
      argv.graphNodeQueryEndpoint,
      argv.indexerGeoCoordinates,
      networkSubgraph,
    )
    logger.info('Successfully connected to network')

    logger.info('Launch indexer management API server')
    const indexerManagementClient = await createIndexerManagementClient({
      models,
      address: network.indexerAddress,
      contracts: network.contracts,
      logger,
      defaults: {
        globalIndexingRule: {
          allocationAmount: parseGRT(argv.defaultAllocationAmount),
          parallelAllocations: 2,
        },
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
      injectDaiGrtConversionRate: argv.injectDaiGrtConversionRate,
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
