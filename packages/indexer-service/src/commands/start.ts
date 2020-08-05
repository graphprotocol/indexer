import { Argv } from 'yargs'
import {
  createLogger,
  connectContracts,
  createMetrics,
  createMetricsServer,
  connectDatabase,
  SubgraphDeploymentID,
  defineStateChannelStoreModels,
} from '@graphprotocol/common-ts'
import { Wallet, providers } from 'ethers'
import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { PaymentManager } from '../payments'
import { NetworkMonitor } from '../network-monitor'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv): Argv => {
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
      .option('connext-log-level', {
        description: 'Connext log level (1-5, default: 0)',
        type: 'number',
        required: false,
        default: 0,
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
      .option('free-query-auth-token', {
        description: 'Auth token that clients can use to query for free',
        type: 'array',
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        required: true,
      })
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (argv: { [key: string]: any } & Argv['argv']): Promise<void> => {
    const logger = createLogger({ name: 'IndexerService' })

    logger.info('Starting up...')

    logger.info('Connecting to Ethereum', { provider: argv.ethereum })
    let ethereum
    try {
      ethereum = new URL(argv.ethereum)
    } catch (e) {
      throw new Error(`Invalid Ethereum URL '${argv.ethereum}': ${e}`)
    }
    const web3 = new providers.JsonRpcProvider({
      url: ethereum.toString(),
      user: ethereum.username,
      password: ethereum.password,
    })
    const network = await web3.getNetwork()
    logger.info('Successfully connected to Ethereum', { provider: web3.connection.url })

    logger.info('Connect to contracts', {
      network: network.name,
      chainId: network.chainId,
    })
    const contracts = await connectContracts(web3, network.chainId)
    logger.info('Successfully to contracts')

    // Spin up a metrics server
    const metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
    })

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
    await defineStateChannelStoreModels(sequelize)
    await sequelize.sync()
    logger.info('Successfully connected to database')

    const wallet = Wallet.fromMnemonic(argv.mnemonic)

    // Create payment manager
    const paymentManager = new PaymentManager({
      logger: logger.child({ component: 'PaymentManager' }),
      metrics,
      sequelize,
      ethereum: argv.ethereum,
      connextMessaging: argv.connextMessaging,
      connextNode: argv.connextNode,
      connextLogLevel: argv.connextLogLevel,
      wallet,
      contracts,
    })

    // Create registered channel monitor
    const networkMonitor = new NetworkMonitor({
      logger: logger.child({ component: 'NetworkMonitor' }),
      wallet,
      graphNode: argv.graphNodeQueryEndpoint,
      networkSubgraphDeployment: new SubgraphDeploymentID(argv.networkSubgraphDeployment),
    })

    // Create a query processor for paid queries
    const queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      paymentManager,
      chainId: network.chainId,
      disputeManagerAddress: contracts.disputeManager.address,
    })

    paymentManager.events.paymentReceived.attach(async ({ stateChannel, payment }) => {
      try {
        await queryProcessor.addPayment(stateChannel, payment)
      } catch (e) {
        logger.warn(`${e}`)
      }
    })

    // Add and remove subgraph state channels as indexing subgraphs change
    networkMonitor.allocationsUpdated.attach(async update => {
      await paymentManager.createStateChannels(update.added)
      await paymentManager.settleStateChannels(update.removed)
    })

    // Spin up a basic webserver
    await createServer({
      logger: logger.child({ component: 'Server' }),
      port: argv.port,
      queryProcessor,
      metrics,
      graphNodeStatusEndpoint: argv.graphNodeStatusEndpoint,
      freeQueryAuthToken: argv.freeQueryAuthToken,
    })
  },
}
