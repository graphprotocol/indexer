import {
  Logger,
  createStateChannel,
  Attestation,
  Metrics,
  NetworkContracts,
  formatGRT,
  SubgraphDeploymentID,
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
  Allocation,
  StateChannelEvents,
  PaymentManagerEvents,
  PaymentReceivedEvent,
} from './types'
import { Evt } from 'evt'

const delay = async (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const deriveChannelKeyPair = (
  wallet: Wallet,
  epoch: number,
  deployment: SubgraphDeploymentID,
): { keyPair: utils.HDNode; publicKey: string } => {
  const hdNode = utils.HDNode.fromMnemonic(wallet.mnemonic.phrase)
  const path = 'm/' + [epoch, ...Buffer.from(deployment.ipfsHash)].join('/')
  const keyPair = hdNode.derivePath(path)
  return {
    keyPair,
    publicKey: utils.computePublicKey(keyPair.publicKey, false),
  }
}

interface StateChannelOptions {
  allocation: Allocation
  logger: Logger
  client: IConnextClient
  signer: ChannelSigner
  wallet: Wallet
  contracts: NetworkContracts
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  allocation: Allocation
}

export class StateChannel implements StateChannelInterface {
  allocation: Allocation
  wallet: Wallet
  events: StateChannelEvents
  contracts: NetworkContracts

  private logger: Logger
  private client: IConnextClient
  private signer: ChannelSigner

  private constructor({
    allocation,
    logger,
    client,
    signer,
    wallet,
    contracts,
  }: StateChannelOptions) {
    this.allocation = allocation
    this.wallet = wallet
    this.contracts = contracts
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
    allocation,
    logger: parentLogger,
    sequelize,
    ethereum,
    connextMessaging,
    connextNode,
    connextLogLevel,
    wallet,
    contracts,
  }: StateChannelCreateOptions): Promise<StateChannel> {
    const subgraphDeploymentID = allocation.subgraphDeploymentID

    const logger = parentLogger.child({
      component: `StateChannel`,
      deployment: subgraphDeploymentID.display,
      createdAtEpoch: allocation.createdAtEpoch.toString(),
    })

    logger.info(`Create state channel`)

    // Derive an epoch and subgraph specific private key
    let { keyPair, publicKey } = deriveChannelKeyPair(
      wallet,
      allocation.createdAtEpoch,
      subgraphDeploymentID,
    )

    // Check if the derived key matches the channel public key published on chain
    if (publicKey !== allocation.publicKey) {
      // It does not -> the channel public key of the allocation was created at
      // allocation.createdAtEpoch-1, but the allocation transaction was only mined
      // at allocation.createdAtEpoch. To avoid a mismatch, we have to derive
      // the channel key pair using allocation.createdAtEpoch-1.
      ;({ keyPair, publicKey } = deriveChannelKeyPair(
        wallet,
        allocation.createdAtEpoch - 1,
        subgraphDeploymentID,
      ))
    }

    const storePrefix = keyPair.address.substr(2)
    const stateChannelWallet = new Wallet(keyPair.privateKey)

    logger.debug(`Channel parameters`, { publicKey, storePrefix })

    try {
      const client = await createStateChannel({
        logger,
        logLevel: connextLogLevel,
        sequelize,
        ethereumProvider: ethereum,
        connextMessaging,
        connextNode,
        privateKey: keyPair.privateKey,

        // Use the Ethereum address of the channel as the store prefix,
        // stripping the leading `0x`
        storePrefix: keyPair.address.substr(2),
      })

      // Collateralize the channel immediately, so there are no delays later;
      // otherwise the first payment to the channel would cause an on-chain
      // collateralization, which, depending on the Ethereum network, can
      // take minutes
      await client.requestCollateral(contracts.token.address)

      // Obtain current free balance
      const freeBalance = await client.getFreeBalance(contracts.token.address)
      const balance = freeBalance[client.signerAddress]

      logger.debug(`Channel configuration`, {
        onChainPublicKey: allocation.publicKey,
        onChainSignerAddress: allocation.id,
        publicKey,
        signerAddress: client.signerAddress,
        publicIdentifier: client.publicIdentifier,
        freeBalance: utils.formatEther(balance),
      })

      if (
        client.publicIdentifier !== getPublicIdentifierFromPublicKey(allocation.publicKey)
      ) {
        throw new Error(
          `Programmer error: Public channel identifier ${
            client.publicIdentifier
          } doesn't match on-chain identifier ${getPublicIdentifierFromPublicKey(
            allocation.publicKey,
          )}. This is because the transaction that created the allocation with the public key '${
            allocation.publicKey
          }' for the subgraph deployment '${
            subgraphDeploymentID.bytes32
          }' took longer than one epoch to be mined. The epoch length of the protocol should probably be increased.`,
        )
      }

      const signer = new ChannelSigner(keyPair.privateKey, ethereum)

      logger.info(`Created state channel successfully`)

      return new StateChannel({
        allocation: allocation,
        wallet: stateChannelWallet,
        logger: logger.child({ publicIdentifier: client.publicIdentifier }),
        client,
        signer,
        contracts,
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

    if (balance.isZero()) {
      this.logger.info(`Settling unused channel via a no-op`)
      return
    }

    try {
      await this.client.withdraw({
        // On-chain, everything is set up so that all withdrawals
        // go to the staking contract (so not really AddressZero)
        recipient: constants.AddressZero,

        // Withdraw everything from the state channel
        amount: balance,

        // Withdraw in GRT
        assetId: this.contracts.token.address,
      })
      this.logger.info(`Successfully settled channel`, { amountGRT: formattedAmount })
    } catch (error) {
      this.logger.warn(`Failed to settle channel`, {
        amountGRT: formattedAmount,
        error: error.message,
      })
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
  connextLogLevel: number
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

  async createStateChannels(allocations: Allocation[]): Promise<void> {
    const queue = new PQueue({ concurrency: 5 })

    for (const allocation of allocations) {
      queue.add(async () => {
        if (!this.stateChannels.has(allocation.id)) {
          const stateChannel = await StateChannel.create({
            ...this.options,
            allocation,
          })

          stateChannel.events.paymentReceived.attach(payment =>
            this.events.paymentReceived.post({ stateChannel, payment }),
          )

          this.stateChannels.set(allocation.id, stateChannel)
        }
      })
    }

    await queue.onIdle()
  }

  async settleStateChannels(allocations: Allocation[]): Promise<void> {
    const queue = new PQueue({ concurrency: 5 })

    for (const allocation of allocations) {
      queue.add(async () => {
        this.logger.info(`Settle state channel`, {
          channelID: allocation.id,
          deployment: allocation.subgraphDeploymentID.display,
          createdAtEpoch: allocation.createdAtEpoch,
        })

        const stateChannel = this.stateChannels.get(allocation.id)
        if (stateChannel !== undefined) {
          await stateChannel.settle()
          this.stateChannels.delete(allocation.id)
        } else {
          this.logger.warn(`Failed to settle channel: Unknown channel ID`, {
            channelID: allocation.id,
            deployment: allocation.subgraphDeploymentID.display,
            createdAtEpoch: allocation.createdAtEpoch,
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
