import { Argv } from 'yargs'
import { database, logging } from '@graphprotocol/common-ts'
import { createServer } from '../server'
import { createMetrics, createMetricsServer } from '@graphprotocol/common-ts/dist/metrics'
import { PaidQueryProcessor } from '../paid-queries'
import { FreeQueryProcessor } from '../free-queries'
import { PaymentManager } from '../payments'

const delay = (time: number) => new Promise(res => setTimeout(res, time))

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv) => {
    return yargs
      .option('mnemonic', {
        describe: 'Ethereum wallet mnemonic',
        type: 'string',
      })
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
      })
      .option('connext-messaging', {
        description: 'Connext messaging URL',
        type: 'string',
      })
      .option('connext-node', {
        description: 'Connext node URL',
        type: 'string',
      })
      .option('postgres-host', {
        description: 'Postgres host',
        type: 'string',
      })
      .option('postgres-port', {
        description: 'Postgres port',
        type: 'number',
        default: 5432,
      })
      .option('postgres-username', {
        description: 'Postgres username',
        type: 'string',
      })
      .option('postgres-password', {
        description: 'Postres password',
        type: 'string',
      })
      .option('postgres-database', {
        description: 'Postgres database name',
        type: 'string',
      })
      .option('port', {
        description: 'Port to serve from',
        type: 'number',
        default: 7600,
      })
      .option('graph-node', {
        description: 'Graph Node to forward queries to',
        type: 'string',
        required: true,
      })
      .option('whitelist', {
        description: 'Client IPs that can query for free',
        type: 'array',
      })
      .demandOption(['mnemonic', 'ethereum', 'connext-node', 'postgres-database'])
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
    let paymentManager = await PaymentManager.create({
      logger: logger.child({ component: 'PaymentManager' }),
      metrics,
      sequelize,
      ethereum: argv.ethereum,
      connextMessaging: argv.connextMessaging,
      connextNode: argv.connextNode,
      mnemonic: argv.mnemonic,
    })

    // Create a query processor for paid queries
    let paidQueryProcessor = new PaidQueryProcessor({
      logger: logger.child({ component: 'PaidQueryProcessor' }),
      graphNode: argv.graphNode,
      metrics,
      paymentManager,
    })

    paymentManager.on('payment-received', payment =>
      paidQueryProcessor.addPayment(payment),
    )

    // Create a query process for free queries (for indexers trusted by
    // a fisherman)
    let freeQueryProcessor = new FreeQueryProcessor({
      logger: logger.child({ component: 'FreeQueryProcessor' }),
      graphNode: argv.graphNode,
      metrics,
    })

    // Spin up a basic webserver
    createServer({
      logger: logger.child({ component: 'Server' }),
      port: argv.port,
      freeQueryProcessor,
      paidQueryProcessor,
      whitelist: argv.whitelist || [],
      metrics,
    })
  },
}
