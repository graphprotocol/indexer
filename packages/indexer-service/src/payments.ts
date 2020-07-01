import {
  attestations,
  logging,
  metrics,
  stateChannels,
  contracts as networkContracts,
  subgraph,
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
import { EventEmitter } from 'eventemitter3'
import PQueue from 'p-queue/dist'

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
import base58 from 'bs58'

const delay = async (ms: number) => {
  return new Promise((resolve, _) => setTimeout(resolve, ms))
}

const bytesToIPFSHash = (bytes: string): string => {
  return base58.encode(addQm(utils.arrayify(bytes)))
}

const addQm = (a: Uint8Array): Uint8Array => {
  let out = new Uint8Array(34)
  out[0] = 0x12
  out[1] = 0x20
  for (let i = 0; i < 32; i++) {
    out[i + 2] = a[i]
  }
  return out as Uint8Array
}

interface StateChannelOptions {
  info: ChannelInfo
  logger: logging.Logger
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

  private logger: logging.Logger
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
    let subgraphDeploymentID = bytesToIPFSHash(info.subgraphDeploymentID)
    let logger = parentLogger.child({
      component: `StateChannel(${subgraphDeploymentID}, ${info.createdAtEpoch})`,
    })

    logger.info(
      `Create state channel for subgraph ID (hex: ${info.subgraphDeploymentID}, base58: ${subgraphDeploymentID})`,
    )

    // Derive an epoch and subgraph specific private key
    let hdNode = utils.HDNode.fromMnemonic(wallet.mnemonic.phrase)
    let path =
      'm/' + [info.createdAtEpoch, ...Buffer.from(subgraphDeploymentID)].join('/')

    logger.info(`Derive key using path '${path}'`)

    let derivedKeyPair = hdNode.derivePath(path)
    let publicKey = derivedKeyPair.publicKey

    logger.debug(`Public key ${publicKey}:`)
    logger.debug(`Store prefix: ${derivedKeyPair.address.substr(2)}`)

    try {
      let client = await stateChannels.createStateChannel({
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
      let freeBalance = await client.getFreeBalance(constants.AddressZero)
      let balance = freeBalance[client.signerAddress]

      logger.info(`On-chain public key: ${info.publicKey}`)
      logger.info(`On-chain signer address: ${info.id}`)

      logger.info(`Channel public key: ${publicKey}`)
      logger.info(`Channel signer address: ${client.signerAddress}`)
      logger.info(`Channel public identifier: ${client.publicIdentifier}`)
      logger.info(`Channel free balance: ${utils.formatEther(balance)}`)

      if (client.publicIdentifier !== getPublicIdentifierFromPublicKey(info.publicKey)) {
        throw new Error(
          `Public channel identifier ${
            client.publicIdentifier
          } doesn't match on-chain identifier ${getPublicIdentifierFromPublicKey(
            info.publicKey,
          )}`,
        )
      }

      let signer = new ChannelSigner(derivedKeyPair.privateKey, ethereum)

      logger.info(`Created state channel successfully`)

      return new StateChannel({
        info,
        privateKey: derivedKeyPair.privateKey,

        logger,
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
    attestation: attestations.Attestation,
  ) {
    let formattedAmount = utils.formatEther(payment.amount)
    let { paymentId } = payment

    this.logger.info(`Unlock payment '${paymentId}' (${formattedAmount} ETH)`)

    let receipt = {
      requestCID: attestation.requestCID,
      responseCID: attestation.responseCID,
      subgraphDeploymentID: attestation.subgraphDeploymentID,
    }
    let signature = utils.joinSignature({
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
          conditionType: ConditionalTransferTypes.SignedTransfer,
          paymentId,
          responseCID: receipt.responseCID,
          signature,
        } as PublicParams.ResolveSignedTransfer)

        this.logger.info(`Unlocked payment '${paymentId}'`)

        attemptUnlock = false
      } catch (e) {
        this.logger.error(
          `Failed to unlock payment '${paymentId}', waiting 1 second before retrying. ${e}`,
        )
        await delay(1000)
      }
    }
  }

  async cancelPayment(payment: ConditionalPayment): Promise<void> {
    let { paymentId, appIdentityHash } = payment

    this.logger.info(`Cancel payment '${paymentId}'`)

    // Uninstall the app to cancel the payment
    await this.client.uninstallApp(appIdentityHash)
  }

  async handleConditionalPayment(payload: EventPayloads.ConditionalTransferCreated<any>) {
    // Ignore our own transfers
    if (payload.sender === this.client.publicIdentifier) {
      return
    }

    // Skip unsupported payment types
    if (payload.type !== ConditionalTransferTypes.SignedTransfer) {
      this.logger.warn(
        `Received payment with unexpected type ${payload.type}, doing nothing`,
      )
      return
    }

    let signedPayload = payload as EventPayloads.SignedTransferCreated

    // Obtain and format transfer amount
    let amount = toBN(payload.amount)
    let formattedAmount = utils.formatEther(amount)

    // Obtain unique app identifier
    let appIdentityHash = (payload as any).appIdentityHash

    this.logger.info(
      `Received payment ${payload.paymentId} (${formattedAmount} ETH) from ${payload.sender} (signer: ${signedPayload.transferMeta.signerAddress})`,
    )

    let payment: ConditionalPayment = {
      paymentId: payload.paymentId!,
      appIdentityHash,
      amount,
      sender: payload.sender,
      signer: signedPayload.transferMeta.signerAddress,
    }

    this.events.paymentReceived.post(payment)
  }

  async settle() {
    let freeBalance = await this.client.getFreeBalance()
    let balance = freeBalance[this.client.signerAddress]
    let formattedAmount = utils.formatEther(balance)

    this.logger.info(`Settle (${formattedAmount} ETH)`)

    await this.client.withdraw({
      // On-chain, everything is set up so that all withdrawals
      // go to the staking contract (so not really AddressZero)
      recipient: constants.AddressZero,

      // Withdraw everything from the state channel
      amount: balance,
    })
  }
}

interface PaymentManagerOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  sequelize: Sequelize
  ethereum: string
  connextMessaging: string
  connextNode: string
  wallet: Wallet
  contracts: networkContracts.NetworkContracts
}

export interface PaymentManagerCreateOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
}

export class PaymentManager implements PaymentManagerInterface {
  wallet: Wallet
  events: PaymentManagerEvents

  private options: PaymentManagerOptions
  private logger: logging.Logger
  private stateChannels: Map<string, StateChannelInterface>
  private contracts: networkContracts.NetworkContracts

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

  async createStateChannels(channels: ChannelInfo[]) {
    let queue = new PQueue({ concurrency: 10 })

    for (let channel of channels) {
      queue.add(async () => {
        if (!this.stateChannels.has(channel.id)) {
          let stateChannel = await StateChannel.create({
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

  async settleStateChannels(channels: ChannelInfo[]) {
    let queue = new PQueue({ concurrency: 10 })

    for (let channel of channels) {
      queue.add(async () => {
        let stateChannel = this.stateChannels.get(channel.id)
        if (stateChannel !== undefined) {
          await stateChannel.settle()
          this.stateChannels.delete(channel.id)
        }
      })
    }

    await queue.onIdle()
  }

  stateChannel(id: string): StateChannelInterface | undefined {
    return this.stateChannels.get(id)
  }
}
