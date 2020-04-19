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
import { toBN, ChannelSigner } from '@connext/utils'

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
      logLevel: 3,
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

    const wallet = Wallet.fromMnemonic(argv.mnemonic)
    const signer = new ChannelSigner(wallet.privateKey, argv.ethereum)

    // // Handle incoming payments
    client.on(
      EventNames.CONDITIONAL_TRANSFER_RECEIVED_EVENT,
      async (eventData: EventPayloads.SignedTransferReceived) => {
        const amount = toBN(eventData.amount)
        let formattedAmount = formatEther(amount)

        if (eventData.type !== ConditionalTransferTypes.SignedTransfer) {
          logger.warn(
            `Received transfer with unexpected type ${eventData.type}, doing nothing`,
          )
          return
        }

        logger.info(
          `Received transfer type ${eventData.type} ${eventData.paymentId} (${formattedAmount} ETH) from ${eventData.sender}, signer is ${eventData.transferMeta.signer}...`,
        )

        if (signer.address !== eventData.transferMeta.signer) {
          logger.error(
            `Transfer's specified signer ${eventData.transferMeta.signer} does not match our signer ${signer.address}`,
          )
          return
        }

        const mockAttestation = hexlify(randomBytes(32))
        const attestationHash = solidityKeccak256(
          ['bytes32', 'bytes32'],
          [mockAttestation, eventData.paymentId],
        )
        const signature = await client.channelProvider.signMessage(attestationHash)

        let attemptTransfer = true
        while (attemptTransfer) {
          try {
            await client.resolveCondition({
              conditionType: ConditionalTransferTypes.SignedTransfer,
              paymentId: eventData.paymentId,
              data: mockAttestation,
              signature,
            } as PublicParams.ResolveSignedTransfer)

            logger.info(
              `Unlocked transfer ${eventData.paymentId} for (${formattedAmount} ETH)`,
            )

            attemptTransfer = false
          } catch (e) {
            logger.error(
              `Caught error unlocking transfer, waiting 5 seconds and retrying...: ${e}`,
            )
            await delay(5000)
          }
        }

        if (!eventData.sender) {
          logger.error(`Sender not specified, cannot send transfer back`)
          return
        }

        await delay(1000)

        attemptTransfer = true
        while (attemptTransfer) {
          try {
            logger.info(`Send ${formattedAmount} ETH back to ${eventData.sender}`)
            let response = await client.transfer({
              amount,
              recipient: eventData.sender,
              assetId: AddressZero,
            })
            logger.info(
              `${formattedAmount} ETH sent back to ${eventData.sender} via transfer ${response.paymentId}`,
            )
            attemptTransfer = false
          } catch (e) {
            logger.error(
              `Failed to send transfer back to ${eventData.sender}, waiting 5 seconds and retrying...: ${e}`,
            )
            await delay(5000)
          }
        }
      },
    )

    logger.info('Waiting to receive transfers...')

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
