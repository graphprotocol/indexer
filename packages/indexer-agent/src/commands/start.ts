import { Argv } from 'yargs'
import { createClient } from '@urql/core'
import {
  createLogger,
  SubgraphDeploymentID,
  connectDatabase,
  defineIndexerManagementModels,
  createIndexerManagementServer,
  createIndexerManagementClient,
  parseGRT,
} from '@graphprotocol/common-ts'

import { startAgent } from '../agent'
import { Network } from '../network'

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
      .option('private-key', {
        description: 'Private key for the wallet',
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
        type: 'array',
        default: ['31.780715', '-41.179504'],
        group: 'Indexer Infrastructure',
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

        return true
      })
  },
  handler: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    argv: { [key: string]: any } & Argv['argv'],
  ): Promise<void> => {
    const logger = createLogger({ name: 'IndexerAgent' })

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

    logger.info('Connect to network')
    const networkSubgraph = argv.networkSubgraphEndpoint
      ? createClient({ url: argv.networkSubgraphEndpoint })
      : new SubgraphDeploymentID(argv.networkSubgraphDeployment)
    const network = await Network.create(
      logger,
      argv.ethereum,
      argv.publicIndexerUrl,
      argv.graphNodeQueryEndpoint,
      argv.indexerGeoCoordinates,
      argv.privateKey,
      networkSubgraph,
    )
    logger.info('Successfully connected to network')

    logger.info('Launch indexer management API server')
    const indexerManagementClient = await createIndexerManagementClient({
      models,
      address: network.indexerAddress,
      contracts: network.contracts,
    })
    await createIndexerManagementServer({
      logger,
      client: indexerManagementClient,
      port: argv.indexerManagementPort,
    })
    logger.info(`Launched indexer management API server`)

    await startAgent({
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
