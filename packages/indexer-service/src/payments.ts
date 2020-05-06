import { logging, metrics, stateChannels } from '@graphprotocol/common-ts'
import {
  IConnextClient,
  IChannelSigner,
  EventNames,
  EventPayloads,
  ConditionalTransferTypes,
  PublicParams,
} from '@connext/types'
import { ChannelSigner, toBN } from '@connext/utils'
import { Sequelize } from 'sequelize'
import {
  PaymentManager as PaymentManagerInterface,
  ConditionalPaymentUnlockInfo,
  ConditionalPayment,
} from './types'
import { AddressZero } from 'ethers/constants'
import { formatEther, solidityKeccak256 } from 'ethers/utils'
import { Wallet } from 'ethers'
import { EventEmitter } from 'events'

async function delay(ms: number) {
  return new Promise((resolve, _) => setTimeout(resolve, ms))
}

interface PaymentManagerOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  client: IConnextClient
  signer: IChannelSigner
}

export interface PaymentManagerCreateOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  sequelize: Sequelize
  ethereum: string
  connextMessaging: string
  connextNode: string
  mnemonic: string
}

export class PaymentManager extends EventEmitter implements PaymentManagerInterface {
  logger: logging.Logger
  client: IConnextClient
  signer: IChannelSigner

  private constructor({ logger, client, signer }: PaymentManagerOptions) {
    super()

    this.logger = logger
    this.client = client
    this.signer = signer

    client.on(
      EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT,
      this.handleConditionalPayment,
    )
  }

  static async create(options: PaymentManagerCreateOptions): Promise<PaymentManager> {
    let {
      logger,
      metrics,
      sequelize,
      ethereum,
      connextMessaging,
      connextNode,
      mnemonic,
    } = options

    logger.info('Create state channel')

    let client = await stateChannels.createStateChannel({
      logger,
      logLevel: 3,
      sequelize,
      ethereumProvider: ethereum,
      connextMessaging,
      connextNode,
      mnemonic,
    })

    logger.info('Created state channel')

    // // Obtain current free balance
    let freeBalance = await client.getFreeBalance(AddressZero)
    let balance = freeBalance[client.signerAddress]

    logger.info(`Free balance: ${formatEther(balance)}`)
    logger.info(`Signer address: ${client.signerAddress}`)
    logger.info(`Public identifier: ${client.publicIdentifier}`)

    const wallet = Wallet.fromMnemonic(mnemonic)
    const signer = new ChannelSigner(wallet.privateKey, ethereum)

    return new PaymentManager({
      logger,
      metrics,
      client,
      signer,
    })
  }

  async unlockPayment(payment: ConditionalPayment, attestation: string) {
    let formattedAmount = formatEther(payment.amount)
    let { paymentId } = payment

    // Hash attestation and payment ID together (is the payment ID necessary?)
    let attestationHash = solidityKeccak256(
      ['bytes32', 'bytes32'],
      [attestation, paymentId],
    )

    // Sign the attestation
    let signature = await this.client.channelProvider.signMessage(attestationHash)

    // Unlock the payment; retry in case there are networking issues
    let attemptUnlock = true
    while (attemptUnlock) {
      try {
        await this.client.resolveCondition({
          conditionType: ConditionalTransferTypes.SignedTransfer,
          paymentId: paymentId,
          data: attestation,
          signature,
        } as PublicParams.ResolveSignedTransfer)

        this.logger.info(`Unlocked transfer ${paymentId} for (${formattedAmount} ETH)`)

        attemptUnlock = false
      } catch (e) {
        this.logger.error(
          `Failed to unlock payment '${paymentId}', waiting 1 second before retrying. Error: ${e}`,
        )
        await delay(1000)
      }
    }
  }

  async cancelPayment(payment: ConditionalPayment): Promise<void> {
    let { paymentId } = payment

    this.logger.info(`Cancel payment '${paymentId}'`)

    // TODO: Call `this.client.uninstallApp`; for this we need the
    // app instance ID though, it's not clear how we can get to that
  }

  async handleConditionalPayment(eventData: EventPayloads.SignedTransferCreated) {
    // Obtain and format transfer amount
    let amount = toBN(eventData.amount)
    let formattedAmount = formatEther(amount)

    // Ignore our own transfers
    if (eventData.sender === this.client.publicIdentifier) {
      return
    }

    // Skip unsupported payment types
    if (eventData.type !== ConditionalTransferTypes.SignedTransfer) {
      this.logger.warn(
        `Received payment with unexpected type ${eventData.type}, doing nothing`,
      )
      return
    }

    this.logger.info(
      `Received payment ${eventData.paymentId} (${formattedAmount} ETH) from ${eventData.sender} (signer: ${eventData.transferMeta.signer})`,
    )

    this.emit('payment-received', {
      id: eventData.paymentId!,
      amount: amount,
      sender: eventData.sender,
      signer: eventData.transferMeta.signer,
    })
  }
}
