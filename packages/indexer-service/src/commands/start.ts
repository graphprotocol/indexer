import { Argv } from 'yargs'
import { database, logging } from '@graphprotocol/common-ts'
import { createServer } from '../server'
import { createMetrics, createMetricsServer } from '@graphprotocol/common-ts/dist/metrics'
import { QueryProcessor } from '../queries'
import { PaymentManager } from '../payments'
import { IndexingSubgraphMonitor } from '../subgraphs'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv) => {
    return yargs
      .option('mnemonic', {
        describe: 'Ethereum wallet mnemonic',
        type: 'string',
        required: true,
      })
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
      })
      .option('connext-messaging', {
        description: 'Connext messaging URL',
        type: 'string',
        required: true,
      })
      .option('connext-node', {
        description: 'Connext node URL',
        type: 'string',
        required: true,
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
        required: true,
      })
      .option('postgres-password', {
        description: 'Postres password',
        type: 'string',
        required: true,
      })
      .option('postgres-database', {
        description: 'Postgres database name',
        type: 'string',
        required: true,
      })
      .option('port', {
        description: 'Port to serve from',
        type: 'number',
        default: 7600,
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint to forward queries to',
        type: 'string',
        required: true,
      })
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string',
        required: true,
      })
      .option('whitelist', {
        description: 'Client IPs that can query for free',
        type: 'array',
      })
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerService' })

    logger.info('Starting up...')

    // Spin up a metrics server
    let metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
    })

    logger.info('Connect to database')
    let sequelize = await database.connect({
      logging: undefined,
      host: argv.postgresHost,
      port: argv.postgresPort,
      username: argv.postgresUsername,
      password: argv.postgresPassword,
      database: argv.postgresDatabase,
    })
    logger.info('Connected to database')

    // Create payment manager
    let paymentManager = new PaymentManager({
      logger: logger.child({ component: 'PaymentManager' }),
      metrics,
      sequelize,
      ethereum: argv.ethereum,
      connextMessaging: argv.connextMessaging,
      connextNode: argv.connextNode,
      mnemonic: argv.mnemonic,
    })

    // Create indexing subgraph monitor
    let indexingSubgraphMonitor = new IndexingSubgraphMonitor({
      logger: logger.child({ component: 'IndexingSubgraphMonitor' }),
      graphNode: argv.graphNodeStatusEndpoint,
    })

    // Create a query processor for paid queries
    let queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      paymentManager,
    })

    paymentManager.on('payment-received', async ({ stateChannel, payment }) => {
      try {
        await queryProcessor.addPayment(stateChannel, payment)
      } catch (e) {
        logger.warn(`${e}`)
      }
    })

    // Add and remove subgraph state channels as indexing subgraphs change
    indexingSubgraphMonitor.on('updated', async (update: any) => {
      let { added, removed } = update

      await paymentManager.createStateChannelsForSubgraphs(added)
      await paymentManager.settleStateChannelsForSubgraphs(removed)
    })

    // Spin up a basic webserver
    createServer({
      logger: logger.child({ component: 'Server' }),
      port: argv.port,
      queryProcessor,
      whitelist: argv.whitelist || [],
      metrics,
    })
  },
}
