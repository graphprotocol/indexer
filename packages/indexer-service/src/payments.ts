import {
  Logger,
  createStateChannel,
  Attestation,
  Metrics,
  NetworkContracts,
  formatGRT,
} from '@graphprotocol/common-ts'
import {
  IConnextClient,
  EventNames,
  EventPayloads,
  ConditionalTransferTypes,
  PublicParams,
} from '@connext/types'
import { ChannelSigner, toBN, getPublicIdentifierFromPublicKey } from '@connext/utils'
import { Sequelize } from 'sequelize'
import { Wallet, constants, utils } from 'ethers'
import PQueue from 'p-queue'

import {
  PaymentManager as PaymentManagerInterface,
  StateChannel as StateChannelInterface,
  ConditionalPayment,
  ChannelInfo,
  StateChannelEvents,
  PaymentManagerEvents,
  PaymentReceivedEvent,
} from './types'
import { Evt } from 'evt'

const delay = async (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface StateChannelOptions {
  info: ChannelInfo
  logger: Logger
  client: IConnextClient
  signer: ChannelSigner
  privateKey: string
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  info: ChannelInfo
}

export class StateChannel implements StateChannelInterface {
  info: ChannelInfo
  privateKey: string
  events: StateChannelEvents

  private logger: Logger
  private client: IConnextClient
  private signer: ChannelSigner

  private constructor({ info, logger, client, signer, privateKey }: StateChannelOptions) {
    this.info = info
    this.privateKey = privateKey
    this.events = {
      paymentReceived: new Evt<ConditionalPayment>(),
    }

    this.logger = logger
    this.client = client
    this.signer = signer

    this.client.on(
      EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT,
      this.handleConditionalPayment.bind(this),
    )
  }

  static async create({
    info,
    logger: parentLogger,
    sequelize,
    ethereum,
    connextMessaging,
    connextNode,
    wallet,
  }: StateChannelCreateOptions): Promise<StateChannel> {
    const subgraphDeploymentID = info.subgraphDeploymentID

    const logger = parentLogger.child({
      component: `StateChannel`,
      deployment: subgraphDeploymentID.display,
      createdAtEpoch: info.createdAtEpoch.toString(),
    })

    logger.info(`Create state channel`)

    // Derive an epoch and subgraph specific private key
    const hdNode = utils.HDNode.fromMnemonic(wallet.mnemonic.phrase)
    const path =
      'm/' +
      [info.createdAtEpoch, ...Buffer.from(subgraphDeploymentID.ipfsHash)].join('/')

    logger.info(`Derive channel key`, { path })

    const derivedKeyPair = hdNode.derivePath(path)
    const uncompressedPublicKey = utils.computePublicKey(derivedKeyPair.publicKey, false)
    const storePrefix = derivedKeyPair.address.substr(2)

    logger.debug(`Channel parameters`, { publicKey: uncompressedPublicKey, storePrefix })

    try {
      const client = await createStateChannel({
        logger,
        logLevel: 1,
        sequelize,
        ethereumProvider: ethereum,
        connextMessaging,
        connextNode,
        privateKey: derivedKeyPair.privateKey,

        // Use the Ethereum address of the channel as the store prefix,
        // stripping the leading `0x`
        storePrefix: derivedKeyPair.address.substr(2),
      })

      // Obtain current free balance
      const freeBalance = await client.getFreeBalance(constants.AddressZero)
      const balance = freeBalance[client.signerAddress]

      logger.debug(`Channel configuration`, {
        onChainPublicKey: info.publicKey,
        onChainSignerAddress: info.id,
        publicKey: uncompressedPublicKey,
        signerAddress: client.signerAddress,
        publicIdentifier: client.publicIdentifier,
        freeBalance: utils.formatEther(balance),
      })

      if (client.publicIdentifier !== getPublicIdentifierFromPublicKey(info.publicKey)) {
        throw new Error(
          `Public channel identifier ${
            client.publicIdentifier
          } doesn't match on-chain identifier ${getPublicIdentifierFromPublicKey(
            info.publicKey,
          )}`,
        )
      }

      const signer = new ChannelSigner(derivedKeyPair.privateKey, ethereum)

      logger.info(`Created state channel successfully`)

      return new StateChannel({
        info,
        privateKey: derivedKeyPair.privateKey,
        logger: logger.child({ publicIdentifier: client.publicIdentifier }),
        client,
        signer,
      })
    } catch (e) {
      console.error(e)
      process.exit(1)
    }
  }

  async unlockPayment(
    payment: ConditionalPayment,
    attestation: Attestation,
  ): Promise<void> {
    const formattedAmount = formatGRT(payment.amount)
    const { paymentId } = payment

    this.logger.info(`Unlock payment`, { paymentId, amountGRT: formattedAmount })

    const receipt = {
      requestCID: attestation.requestCID,
      responseCID: attestation.responseCID,
      subgraphDeploymentID: attestation.subgraphDeploymentID,
    }
    const signature = utils.joinSignature({
      r: attestation.r,
      s: attestation.s,
      v: attestation.v,
    })

    // Unlock the payment; retry in case there are networking issues
    let attemptUnlock = true
    let attempts = 0
    while (attemptUnlock && attempts < 5) {
      attempts += 1

      try {
        await this.client.resolveCondition({
          conditionType: ConditionalTransferTypes.GraphTransfer,
          paymentId,
          responseCID: receipt.responseCID,
          signature,
        } as PublicParams.ResolveGraphTransfer)

        this.logger.info(`Successfully unlocked payment`, {
          paymentId,
          amountGRT: formattedAmount,
        })

        attemptUnlock = false
      } catch (error) {
        this.logger.error(`Failed to unlock payment, trying again in 1s`, {
          paymentId,
          amountGRT: formattedAmount,
          error,
        })
        await delay(1000)
      }
    }
  }

  async cancelPayment(payment: ConditionalPayment): Promise<void> {
    const { paymentId, appIdentityHash } = payment

    this.logger.info(`Cancel payment`, { paymentId })

    // Uninstall the app to cancel the payment
    await this.client.uninstallApp(appIdentityHash)
  }

  async handleConditionalPayment(
    payload: EventPayloads.ConditionalTransferCreated<never>,
  ): Promise<void> {
    // Ignore our own transfers
    if (payload.sender === this.client.publicIdentifier) {
      return
    }

    // Skip unsupported payment types
    if (payload.type !== ConditionalTransferTypes.GraphTransfer) {
      this.logger.warn(`Ignoring payment with unexpected type`, { type: payload.type })
      return
    }

    // Skip payments without payment ID
    if (!payload.paymentId) {
      this.logger.warn(`Ignoring payment without payment ID`)
      return
    }

    const signedPayload = payload as EventPayloads.GraphTransferCreated

    // Obtain and format transfer amount
    const amount = toBN(payload.amount)
    const formattedAmount = formatGRT(amount)

    this.logger.info(`Received payment`, {
      paymentId: payload.paymentId,
      amountGRT: formattedAmount,
      sender: payload.sender,
      signer: signedPayload.transferMeta.signerAddress,
    })

    const payment: ConditionalPayment = {
      paymentId: payload.paymentId,
      appIdentityHash: payload.appIdentityHash,
      amount,
      sender: payload.sender,
      signer: signedPayload.transferMeta.signerAddress,
    }

    this.events.paymentReceived.post(payment)
  }

  async settle(): Promise<void> {
    const freeBalance = await this.client.getFreeBalance()
    const balance = freeBalance[this.client.signerAddress]
    const formattedAmount = formatGRT(balance)

    this.logger.info(`Settle channel`, { amountGRT: formattedAmount })

    try {
      await this.client.withdraw({
        // On-chain, everything is set up so that all withdrawals
        // go to the staking contract (so not really AddressZero)
        recipient: constants.AddressZero,

        // Withdraw everything from the state channel
        amount: balance,
      })
      this.logger.info(`Successfully settled channel`, { amountGRT: formattedAmount })
    } catch (error) {
      this.logger.warn(`Failed to settle channel`, { amountGRT: formattedAmount, error })
    }
  }
}

interface PaymentManagerOptions {
  logger: Logger
  metrics: Metrics
  sequelize: Sequelize
  ethereum: string
  connextMessaging: string
  connextNode: string
  wallet: Wallet
  contracts: NetworkContracts
}

export interface PaymentManagerCreateOptions {
  logger: Logger
  metrics: Metrics
}

export class PaymentManager implements PaymentManagerInterface {
  wallet: Wallet
  events: PaymentManagerEvents

  private options: PaymentManagerOptions
  private logger: Logger
  private stateChannels: Map<string, StateChannelInterface>
  private contracts: NetworkContracts

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
    this.events = {
      paymentReceived: new Evt<PaymentReceivedEvent>(),
    }

    this.options = options
    this.logger = options.logger
    this.stateChannels = new Map()
    this.contracts = options.contracts
  }

  async createStateChannels(channels: ChannelInfo[]): Promise<void> {
    const queue = new PQueue({ concurrency: 10 })

    for (const channel of channels) {
      queue.add(async () => {
        if (!this.stateChannels.has(channel.id)) {
          const stateChannel = await StateChannel.create({
            ...this.options,
            info: channel,
          })

          stateChannel.events.paymentReceived.attach(payment =>
            this.events.paymentReceived.post({ stateChannel, payment }),
          )

          this.stateChannels.set(channel.id, stateChannel)
        }
      })
    }

    await queue.onIdle()
  }

  async settleStateChannels(channels: ChannelInfo[]): Promise<void> {
    const queue = new PQueue({ concurrency: 10 })

    for (const channel of channels) {
      queue.add(async () => {
        this.logger.info(`Settle state channel`, {
          channelID: channel.id,
          deployment: channel.subgraphDeploymentID.display,
          createdAtEpoch: channel.createdAtEpoch,
        })

        const stateChannel = this.stateChannels.get(channel.id)
        if (stateChannel !== undefined) {
          await stateChannel.settle()
          this.stateChannels.delete(channel.id)
        } else {
          this.logger.warn(`Failed to settle state channel: Unknown channel ID`, {
            channelID: channel.id,
            deployment: channel.subgraphDeploymentID.display,
            createdAtEpoch: channel.createdAtEpoch,
          })
        }
      })
    }

    await queue.onIdle()
  }

  stateChannel(id: string): StateChannelInterface | undefined {
    return this.stateChannels.get(id)
  }
}
