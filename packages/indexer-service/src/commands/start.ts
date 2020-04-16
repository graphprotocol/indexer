import { Argv } from 'yargs'
import { database, logging, stateChannels } from '@graphprotocol/common-ts'
import {
  EventPayloads,
  EventNames,
  ConditionalTransferTypes,
  PublicParams,
} from '@connext/types'
import { formatEther, hexlify, randomBytes, solidityKeccak256 } from 'ethers/utils'
import { AddressZero } from 'ethers/constants'
import express from 'express'
import morgan from 'morgan'
import { Stream } from 'stream'
import { utils, Wallet } from 'ethers'
import { signChannelMessage } from '@connext/crypto'
import { toBN } from '@connext/utils'

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
      .demandOption(['mnemonic', 'ethereum', 'connext-node', 'postgres-database'])
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerService' })

    logger.info('Starting up...')

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

    logger.info('Create state channel')
    let client = await stateChannels.createStateChannel({
      sequelize,
      mnemonic: argv.mnemonic,
      ethereumProvider: argv.ethereum,
      connextMessaging: argv.connextMessaging,
      connextNode: argv.connextNode,
      logLevel: 1,
    })
    logger.info('Created state channel')

    // Temporary logic:
    //
    // 1. Listen to incoming payments
    // 2. Whenever there is an incoming payment, send it right back

    // Obtain current free balance
    let freeBalance = await client.getFreeBalance(AddressZero)
    let balance = freeBalance[client.signerAddress]
    logger.info(`Channel free balance: ${utils.formatEther(balance)}`)

    logger.info(`Signer address: ${client.signerAddress}`)
    logger.info(`xpub: ${client.publicIdentifier}`)

    const wallet = Wallet.fromMnemonic(argv.mnemonic, "m/44'/60'/0'/25446/0")

    // // Handle incoming payments
    client.on(
      EventNames.CONDITIONAL_TRANSFER_RECEIVED_EVENT,
      async (eventData: EventPayloads.SignedTransferReceived) => {
        const amount = toBN(eventData.amount)
        let formattedAmount = formatEther(amount)

        logger.info(
          `Received payment ${eventData.paymentId} (${formattedAmount} ETH) from ${eventData.sender}, unlocking with key from ${wallet.address}...`,
        )

        const mockAttestation = hexlify(randomBytes(32))
        const digest = solidityKeccak256(
          ['bytes32', 'bytes32'],
          [mockAttestation, eventData.paymentId],
        )
        const signature = await signChannelMessage(wallet.privateKey, digest)
        await client.resolveCondition({
          conditionType: ConditionalTransferTypes.SignedTransfer,
          paymentId: eventData.paymentId,
          data: mockAttestation,
          signature,
        } as PublicParams.ResolveSignedTransfer)

        logger.info(
          `Unlocked payment ${eventData.paymentId} for (${formattedAmount} ETH)`,
        )

        if (!eventData.sender) {
          logger.error(`Sender not specified, cannot send payment back`)
          return
        }

        await delay(1000)

        try {
          logger.info(`Send ${formattedAmount} ETH back to ${eventData.sender}`)
          let response = await client.transfer({
            amount,
            recipient: eventData.sender,
            assetId: AddressZero,
          })
          logger.info(
            `${formattedAmount} ETH sent back to ${eventData.sender} via payment ${response.paymentId}`,
          )
        } catch (e) {
          logger.error(`Failed to send payment back to ${eventData.sender}: ${e.message}`)
        }
      },
    )

    logger.info('Waiting to receive payments...')

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
