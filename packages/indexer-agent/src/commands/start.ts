import { Argv } from 'yargs'
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

export default {
  command: 'start',
  describe: 'Start the agent',
  builder: (yargs: Argv): Argv => {
    return yargs
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint for querying subgraphs',
        type: 'string',
        required: true,
      })
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string',
        required: true,
      })
      .option('graph-node-admin-endpoint', {
        description:
          'Graph Node endpoint for applying and updating subgraph deployments',
        type: 'string',
        required: true,
      })
      .option('public-indexer-url', {
        description: 'Indexer endpoint for receiving requests from the network',
        type: 'string',
        required: true,
      })
      .option('mnemonic', {
        description: 'Mnemonic for the wallet',
        type: 'string',
        required: true,
      })
      .options('indexer-geo-coordinates', {
        description: `Coordinates describing the Indexer's location using latitude and longitude`,
        type: 'array',
        default: ['31.780715', '-41.179504'],
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        required: true,
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
      })
      .option('default-allocation-amount', {
        description:
          'Default amount of GRT to allocate to a subgraph deployment',
        type: 'string',
        default: '0.01',
        required: false,
      })
      .option('indexer-management-port', {
        description: 'Port to serve the indexer management API at',
        type: 'number',
        default: 8000,
        required: false,
      })
      .option('postgres-host', {
        description: 'Postgres host',
        type: 'string',
        required: true,
      })
      .option('postgres-port', {
        description: 'Postgres port',
        type: 'number',
        default: 5432,
      })
      .option('postgres-username', {
        description: 'Postgres username',
        type: 'string',
        required: false,
        default: 'postgres',
      })
      .option('postgres-password', {
        description: 'Postgres password',
        type: 'string',
        default: '',
        required: false,
      })
      .option('postgres-database', {
        description: 'Postgres database name',
        type: 'string',
        required: true,
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
    const models = await defineIndexerManagementModels(sequelize)
    await sequelize.sync()
    logger.info('Successfully connected to database')

    logger.info('Launch indexer management API server')
    const indexerManagementClient = await createIndexerManagementClient({
      models,
    })
    await createIndexerManagementServer({
      logger,
      client: indexerManagementClient,
      port: argv.indexerManagementPort,
    })
    logger.info(`Launched indexer management API server`)

    await startAgent({
      mnemonic: argv.mnemonic,
      adminEndpoint: argv.graphNodeAdminEndpoint,
      statusEndpoint: argv.graphNodeStatusEndpoint,
      queryEndpoint: argv.graphNodeQueryEndpoint,
      publicIndexerUrl: argv.publicIndexerUrl,
      indexerGeoCoordinates: argv.indexerGeoCoordinates,
      ethereumProvider: argv.ethereum,
      logger,
      networkSubgraphDeployment: new SubgraphDeploymentID(
        argv.networkSubgraphDeployment,
      ),
      indexNodeIDs: argv.indexNodeIds,
      indexerManagement: indexerManagementClient,
      defaultAllocationAmount: parseGRT(argv.defaultAllocationAmount),
    })
  },
}
