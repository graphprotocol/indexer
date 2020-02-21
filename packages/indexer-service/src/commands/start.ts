import { Argv } from 'yargs'
import { database, logging, stateChannels } from '@graphprotocol/common-ts'
import { utils } from 'ethers'
import express from 'express'
import morgan from 'morgan'
import { Stream } from 'stream'

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
      .demandOption(['mnemonic', 'ethereum', 'connext-node', 'postgres-database'])
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerService' })

    logger.info('Starting up')

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

    stateChannels.Record.initialize(sequelize)
    await sequelize.sync()

    logger.info('Create state channel')
    let client = await stateChannels.createStateChannel({
      sequelize,
      mnemonic: argv.mnemonic,
      ethereumProvider: argv.ethereum,
      connextNode: argv.connextNode,
      logLevel: 1,
    })
    logger.info('Created state channel')

    // Temporary logic:
    //
    // 1. Check if there is enough money to send a payment to a test indexer account
    // 2. (Maybe) deposit 0.01 ETH into the state channel
    //
    // After that:
    //
    // 1. Listen to incoming payments
    // 2. Whenever there is an incoming payment, send it right back

    // Obtain current free balance
    let freeBalance = await client.getFreeBalance()
    let balance = freeBalance[client.signerAddress]

    logger.info(`Signer address: ${client.signerAddress}`)

    if (!balance || balance.lt(utils.parseEther('0.1'))) {
      logger.info(`Balance too low: ${balance ? utils.formatEther(balance) : 0} < 0.1`)
      logger.info('Deposit 0.01 ETH')

      let state = await client.deposit({
        amount: utils.parseEther('0.01').toString(),
      })

      logger.info(
        `Balance after deposit: ${utils.formatEther(
          state.freeBalance[client.signerAddress],
        )}`,
      )
    } else {
      logger.info(`Balance: ${utils.formatEther(balance)}`)
    }

    // Handle incoming payments
    client.on('RECEIVE_TRANSFER_FINISHED_EVENT', data => {
      console.log('Received payment:', data)

      // TODO: Send the payment back to the sender
    })

    // Spin up a basic webserver
    let serverLogger = logger.child({ component: 'Server' })
    let serverLoggerStream = new Stream.Writable()
    serverLoggerStream._write = (chunk, _, next) => {
      serverLogger.debug(chunk.toString().trim())
      next()
    }
    serverLogger.info(`Start at port ${argv.port}`)
    let server = express()
    server.use(morgan('tiny', { stream: serverLoggerStream }))
    server.get('/', (_, res, __) => {
      res.status(200).send('Ready to roll!')
    })
    server.listen(argv.port, () => {
      serverLogger.info(`Started at port ${argv.port}`)
    })
  },
}
