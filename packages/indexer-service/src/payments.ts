import {
  attestations,
  logging,
  metrics,
  stateChannels,
  contracts as networkContracts,
} from '@graphprotocol/common-ts'
import {
  IConnextClient,
  IChannelSigner,
  EventNames,
  EventPayloads,
  ConditionalTransferTypes,
  PublicParams,
  EventPayload,
  CreatedSignedTransferMeta,
} from '@connext/types'
import { ChannelSigner, toBN } from '@connext/utils'
import { Sequelize } from 'sequelize'
import { Wallet, constants, utils } from 'ethers'
import { EventEmitter } from 'eventemitter3'
import PQueue from 'p-queue/dist'

import {
  PaymentManager as PaymentManagerInterface,
  StateChannel as StateChannelInterface,
  ConditionalPayment,
  StateChannelEventNames,
  PaymentManagerEventNames,
} from './types'

async function delay(ms: number) {
  return new Promise((resolve, _) => setTimeout(resolve, ms))
}

interface StateChannelOptions {
  logger: logging.Logger
  client: IConnextClient
  signer: ChannelSigner
  subgraph: string
  epoch: number
  privateKey: string
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  epoch: number
  subgraph: string
}

export class StateChannel extends EventEmitter<StateChannelEventNames>
  implements StateChannelInterface {
  logger: logging.Logger
  client: IConnextClient
  signer: ChannelSigner
  epoch: number
  subgraph: string
  privateKey: string

  private constructor({
    logger,
    subgraph,
    epoch,
    client,
    signer,
    privateKey,
  }: StateChannelOptions) {
    super()

    this.logger = logger
    this.subgraph = subgraph
    this.epoch = epoch
    this.client = client
    this.signer = signer
    this.privateKey = privateKey

    this.client.on(
      EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT,
      this.handleConditionalPayment.bind(this),
    )
  }

  static async create({
    subgraph,
    logger: parentLogger,
    sequelize,
    ethereum,
    connextMessaging,
    connextNode,
    mnemonic,
    epoch,
  }: StateChannelCreateOptions): Promise<StateChannel> {
    let logger = parentLogger.child({ component: `StateChannel(${subgraph}, ${epoch})` })

    logger.info(`Create state channel`)

    // Derive an epoch and subgraph specific private key
    let hdNode = utils.HDNode.fromMnemonic(mnemonic)
    let path = 'm/' + [epoch, ...Buffer.from(subgraph)].join('/')

    logger.info(`Derive key using path '${path}'`)

    let derivedKeyPair = hdNode.derivePath(path)
    let publicKey = derivedKeyPair.publicKey

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

      logger.info(`Public key: ${publicKey}`)
      logger.info(`Signer address: ${client.signerAddress}`)
      logger.info(`Public identifier: ${client.publicIdentifier}`)
      logger.info(`Free balance: ${utils.formatEther(balance)}`)

      let signer = new ChannelSigner(derivedKeyPair.privateKey, ethereum)

      logger.info(`Created state channel successfully`)

      return new StateChannel({
        logger,
        client,
        signer,
        subgraph,
        epoch,
        privateKey: derivedKeyPair.privateKey,
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

    this.emit('payment-received', payment)
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
  mnemonic: string
  contracts: networkContracts.NetworkContracts
}

export interface PaymentManagerCreateOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
}

export class PaymentManager extends EventEmitter<PaymentManagerEventNames>
  implements PaymentManagerInterface {
  options: PaymentManagerOptions

  logger: logging.Logger
  wallet: Wallet
  stateChannels: Map<string, StateChannelInterface>
  contracts: networkContracts.NetworkContracts

  constructor(options: PaymentManagerOptions) {
    super()

    this.options = options
    this.logger = options.logger
    this.wallet = Wallet.fromMnemonic(options.mnemonic)
    this.stateChannels = new Map()
    this.contracts = options.contracts
  }

  async createStateChannelsForSubgraphs(subgraphs: string[]) {
    let queue = new PQueue({ concurrency: 2 })

    // Create state channels using the current epoch for now
    // TODO: This will need to use the indexer database shared between
    // indexer agent and service in order to establish channels based
    // on the epoch they were created at
    let epoch = (await this.contracts.epochManager.currentEpoch()).toNumber()

    for (let subgraph of subgraphs) {
      queue.add(async () => {
        if (!this.stateChannels.has(subgraph)) {
          let stateChannel = await StateChannel.create({
            ...this.options,
            subgraph,
            epoch,
          })

          stateChannel.on('payment-received', payment => {
            this.emit('payment-received', { payment, stateChannel })
          })

          this.stateChannels.set(subgraph, stateChannel)
        }
      })
    }

    await queue.onIdle()
  }

  async settleStateChannelsForSubgraphs(subgraphs: string[]) {
    let queue = new PQueue({ concurrency: 2 })

    for (let subgraph of subgraphs) {
      queue.add(async () => {
        if (this.stateChannels.has(subgraph)) {
          let stateChannel = this.stateChannels.get(subgraph)!
          await stateChannel.settle()
          this.stateChannels.delete(subgraph)
        }
      })
    }

    await queue.onIdle()
  }

  stateChannelForSubgraph(subgraph: string): StateChannelInterface | undefined {
    return this.stateChannels.get(subgraph)
  }
}
