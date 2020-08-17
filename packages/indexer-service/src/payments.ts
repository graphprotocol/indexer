import {
  Logger,
  createStateChannel,
  Attestation,
  Metrics,
  NetworkContracts,
  formatGRT,
  SubgraphDeploymentID,
  PaymentStoreModel,
  HexBytes32,
  Awaitable,
  PaymentStore,
  CompleteModel,
  RawSignature,
} from '@graphprotocol/common-ts'
import {
  IConnextClient,
  EventPayloads,
  ConditionalTransferTypes,
  PublicParams,
  EventNames,
} from '@connext/types'
import { ChannelSigner, toBN, getPublicIdentifierFromPublicKey } from '@connext/utils'
import { Sequelize, Transaction } from 'sequelize'
import { Wallet, constants, utils, BigNumber } from 'ethers'
import { Evt } from 'evt'
import PQueue from 'p-queue'

import {
  PaymentManager as PaymentManagerInterface,
  StateChannel as StateChannelInterface,
  Allocation,
  PaymentAppState,
  UnvalidatedPaymentAppState,
  QueryError,
  validateHexBytes32,
  parseUint256,
  validateSignature,
} from './types'

// TODO: should this be removed?
interface StateChannelEvents {
  paymentReceived: Evt<ConditionalPayment>
}

// TODO: should this be removed?
export interface ConditionalPayment {
  paymentId: string
  appIdentityHash: string
  amount: BigNumber
  sender: string
  signer: string
}

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
  buffer: PaymentStoreBuffer
  model: PaymentStoreModel
  paymentIdToChannel: Map<HexBytes32, StateChannel>
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  allocation: Allocation
  paymentIdToChannel: Map<HexBytes32, StateChannel>
}

/**
 * attempts <= 0 retries forever
 */
async function retryWithDelay<T>(attempts: number, f: () => Awaitable<T>): Promise<T> {
  for (;;) {
    try {
      return await f()
    } catch (error) {
      if (--attempts) {
        await delay(1000)
      } else {
        throw error
      }
    }
  }
}

export class StateChannel implements StateChannelInterface {
  allocation: Allocation
  wallet: Wallet
  events: StateChannelEvents
  contracts: NetworkContracts

  private logger: Logger
  private client: IConnextClient
  private signer: ChannelSigner
  private buffer: PaymentStoreBuffer
  private model: PaymentStoreModel
  private paymentIdToChannel: Map<HexBytes32, StateChannel>

  // A list of apps, in the order they were installed.
  // Connext has a limit of apps that can be installed on any channel.
  // The limit is something like 32. With each new concurrent app installed,
  // the amount of gas required to file a dispute increases significantly so
  // we want to keep the installed apps to a minimum. In practice at least 2 apps
  // are required: An 'active' app which is being drained by queries, and a
  // 'standby' app that has been setup so that when it is time to transfer to a
  // new app there isn't a latency hiccup for queries while setting up the app.
  // Here, we extend this to 3 apps to give a little bit of a buffer to avoid
  // any race conditions.
  private appsByInstall: HexBytes32[]

  // TODO: (Zac) HIGH Manage order of apps, and automatically
  // finalize when there are too many

  private constructor({
    allocation,
    logger,
    client,
    signer,
    wallet,
    contracts,
    buffer,
    model,
    paymentIdToChannel,
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
    this.buffer = buffer
    this.model = model
    this.paymentIdToChannel = paymentIdToChannel
    this.appsByInstall = []

    this.client.on(
      EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT,
      this.handleAppInstall.bind(this),
    )
  }

  // TODO: (Zac) MED Load state channels and apps on startup, finalizing if necessary

  /**
   * Creates a StateChannel. The StateChannel may have multiple apps installed on it.
   * Each app may have multiple payments
   */
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
    paymentStoreModel,
    paymentIdToChannel,
  }: StateChannelCreateOptions): Promise<StateChannel> {
    const subgraphDeploymentID = allocation.subgraphDeploymentID
    const buffer = new PaymentStoreBuffer(sequelize, paymentStoreModel)

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
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
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
        allocation,
        wallet: stateChannelWallet,
        logger: logger.child({ publicIdentifier: client.publicIdentifier }),
        client,
        signer,
        contracts,
        buffer,
        model: paymentStoreModel,
        paymentIdToChannel,
      })
    } catch (e) {
      console.error(e)
      process.exit(1)
    }
  }

  async handleAppInstall(
    payload: EventPayloads.ConditionalTransferCreated<unknown>,
  ): Promise<void> {
    // Ignore our own transfers
    if (payload.sender === this.client.publicIdentifier) {
      return
    }

    // Skip unsupported payment types
    if (payload.type !== ConditionalTransferTypes.GraphBatchedTransfer) {
      this.logger.warn(`Ignoring payment with unexpected type`, { type: payload.type })
      return
    }

    // Skip payments without payment ID
    if (!payload.paymentId) {
      this.logger.warn(`Ignoring payment without payment ID`)
      return
    }

    // Close the oldest app
    try {
      while (this.appsByInstall.length > 1) {
        const oldest = this.appsByInstall[0]
        const state = await this.buffer.take(oldest)
        await this.finalizeApp(state)
      }
    } catch (error) {
      this.logger.error('Failed in finalize app. Will try again on settle', {
        error: error.message,
      })
      // Press on to install the new app
    }

    // TODO: (Zac) LOW Validate inputs from hub
    const initialPaymentState: PaymentStore = {
      paymentId: payload.paymentId as HexBytes32,
      connextAppIdHash: payload.appIdentityHash as HexBytes32,
      // TODO: (Zac) LOW Casting here is incorrect, because this may be shorter than HexBytes32
      // I don't think it will cause any problems with what's implemented so far, but should fix
      totalCollateralization: payload.amount.toHexString() as HexBytes32,
      channelId: this.allocation.id as HexBytes32,
      totalPayment: null,
      finished: false,
      requestCID: null,
      responseCID: null,
      consumerSignature: null,
      attestationSignature: null,
    }
    this.appsByInstall.push(payload.paymentId as HexBytes32)
    await this.model.create(initialPaymentState)
    this.paymentIdToChannel.set(payload.paymentId as HexBytes32, this)

    // Obtain and format transfer amount
    const amount = toBN(payload.amount)
    const formattedAmount = formatGRT(amount)

    this.logger.info(`App installed`, {
      paymentId: payload.paymentId,
      amountGRT: formattedAmount,
      sender: payload.sender,
    })
  }
  // TODO: (Zac) LOW: Move all per-app logic into the state channel

  async settle(): Promise<void> {
    // TODO: (Zac) MED Figure out the right way to handle transactions here.
    // We don't want to accept queries while finishing apps,
    // We don't want to install new apps while closing channels,
    // TODO: (Zac) MED Coordinate with the buffer, and coordinate with outstanding queries

    // Ensure any payments to be collected are on disk
    await this.buffer.finish()

    const unfinishedBusiness = await this.model.findAll({
      where: {
        channelId: this.allocation.id,
        finished: false,
      },
    })
    for (const finalState of unfinishedBusiness) {
      await this.finalizeApp(finalState as CompleteModel<PaymentStore>)
    }

    const freeBalance = await this.client.getFreeBalance()
    const balance = freeBalance[this.client.signerAddress]
    const formattedAmount = formatGRT(balance)

    this.logger.info(`Settle channel`, { amountGRT: formattedAmount })

    if (balance.isZero()) {
      this.logger.info(`Settling unused channel via a no-op`)
      return
    }

    try {
      await retryWithDelay(5, () =>
        this.client.withdraw({
          // On-chain, everything is set up so that all withdrawals
          // go to the staking contract (so not really AddressZero)
          recipient: constants.AddressZero,

          // Withdraw everything from the state channel
          amount: balance,

          // Withdraw in GRT
          assetId: this.contracts.token.address,
        }),
      )
      this.logger.info(`Successfully settled channel`, { amountGRT: formattedAmount })
    } catch (error) {
      this.logger.warn(`Failed to settle channel`, {
        amountGRT: formattedAmount,
        error: error.message,
      })
    }
  }

  savePayment(payment: PaymentAppState, attestation: Attestation): void {
    this.buffer.addPayment(payment, attestation)
  }

  private async finalizeApp(finalState: CompleteModel<PaymentStore>): Promise<void> {
    // Remove from list of installed apps
    for (;;) {
      const index = this.appsByInstall.indexOf(finalState.paymentId)
      if (index < 0) {
        break
      }
      this.appsByInstall.splice(index)
    }

    // TODO: (Zac) LOW Upgrade transaction types to serializable?
    if (finalState.totalPayment == null) {
      // It is possible that we never served any queries on this channel.
      // In that case, uninstall the app to cancel any payments
      await retryWithDelay(5, () => this.client.uninstallApp(finalState.connextAppIdHash))
    } else {
      // Make the final move of the game.
      await retryWithDelay(5, () =>
        this.client.resolveCondition({
          conditionType: ConditionalTransferTypes.GraphBatchedTransfer,
          // PaymentId is a part of the app state, so it's not immediately obvious why it's here.
          // The answer is that Connext uses this to disambiguate what app is being resolved
          paymentId: finalState.paymentId,
          responseCID: finalState.responseCID,
          requestCID: finalState.requestCID,
          totalPaid: BigNumber.from(finalState.totalPayment),
          consumerSignature: finalState.consumerSignature,
          attestationSignature: finalState.attestationSignature,
        } as PublicParams.ResolveGraphBatchedTransfer),
      )
    }

    let finalAmount = '0x0'
    if (finalState.totalPayment != null) {
      finalAmount = finalState.totalPayment
    }

    this.logger.info('Finalized app', { amount: formatGRT(finalAmount) })

    finalState.finished = true
    await finalState.save()
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
  paymentStoreModel: PaymentStoreModel
}

export interface PaymentManagerCreateOptions {
  logger: Logger
  metrics: Metrics
}

/**
 * In-memory buffer for payment stores. This exists to take database writing outside
 * of the critical query path.
 *
 * Periodically flushes to disk.
 *
 * Note that techniques like this may be insecure if multiple indexer agents
 * are responsible for multiple apps.
 */
class PaymentStoreBuffer {
  private byId: Map<HexBytes32, [PaymentAppState, Attestation]>
  private dirty: HexBytes32[]
  private sequelize: Sequelize
  private store: PaymentStoreModel
  private finishing: boolean
  private flushTask: Promise<void>

  constructor(sequelize: Sequelize, store: PaymentStoreModel) {
    this.store = store
    this.sequelize = sequelize
    this.byId = new Map()
    this.dirty = []
    this.flushTask = this.flush()
    this.finishing = false
  }

  finish(): Promise<void> {
    this.finishing = true
    return this.flushTask
  }

  // TODO: (Zac) This is kind of silly, the method breakdown kind of fell apart.
  async take(paymentId: HexBytes32): Promise<CompleteModel<PaymentStore>> {
    // TODO: (Zac) This silences errors. No good. It is late and I am tired.
    await this.flushToDiskById(paymentId)
    return await this.loadPaymentState(paymentId)
  }

  // TODO: (Zac) Performance: We don't always need to load all fields
  private async loadPaymentState(
    paymentId: HexBytes32,
    transaction?: Transaction,
  ): Promise<CompleteModel<PaymentStore>> {
    const maybe = await this.store.findByPk(paymentId, { transaction })
    if (maybe == null) {
      throw new QueryError('Unrecognized paymentId')
    }

    // Loading all fields, so this should satisfy the full interface
    return maybe as CompleteModel<PaymentStore>
  }

  private async flushToDisk(
    payment: PaymentAppState,
    attestation: Attestation,
  ): Promise<void> {
    // Put this in a transaction because this has a write which is
    // dependent on a read and must be atomic or payments could be dropped.
    // We're only expecting one process to control the channel and app. But,
    // this may be an added layer of safety.
    this.sequelize.transaction(
      // https://docs.microsoft.com/en-us/sql/connect/jdbc/understanding-isolation-levels?view=sql-server-ver15
      // Quote:
      // "Transactions must be run at an isolation level of at least repeatable read
      //  to prevent lost updates that can occur when two transactions each retrieve
      //  the same row, and then later update the row based on the originally
      //  retrieved values."
      { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
      async (transaction: Transaction) => {
        const prevState = await this.loadPaymentState(payment.paymentId)

        if (
          prevState.totalPayment == null ||
          BigInt(prevState.totalPayment) < payment.totalPayment
        ) {
          // TODO: (Zac) LOW This may not be HexBytes32. Needs fix
          prevState.totalPayment = ('0x' +
            payment.totalPayment.toString(16)) as HexBytes32
          prevState.consumerSignature = payment.signature
          prevState.attestationSignature = utils.joinSignature(
            attestation,
          ) as RawSignature
          prevState.requestCID = attestation.requestCID as HexBytes32
          prevState.responseCID = attestation.responseCID as HexBytes32

          await prevState.save({ transaction })
        }
      },
    )
  }

  private async flush(): Promise<void> {
    for (;;) {
      if (!this.finishing) {
        await delay(1000 / (this.dirty.length + 1))
      }

      // Pop and swap a random dirty entry
      const index = Math.floor(Math.random() * this.dirty.length)
      if (index === this.dirty.length) {
        if (this.finishing) {
          return
        } else {
          continue
        }
      }

      const dirty = this.dirty[index]
      this.dirty[index] = this.dirty[this.dirty.length - 1]
      this.dirty.pop()
      await this.flushToDiskById(dirty)
    }
  }

  private async flushToDiskById(id: HexBytes32) {
    const data = this.byId.get(id)
    if (data == null) {
      return
    }
    const [payment, attestation] = data

    // This is necessary because addPayment may be called concurrently.
    // Without this line, addPayment would not add the id to the dirty list,
    // and the payment may never flush
    this.byId.delete(id)

    // Flush to disk
    try {
      await this.flushToDisk(payment, attestation)
    } catch (error) {
      // If we fail to save, try again later
      // Calling addPayment again mixes whatever state we took out with
      // any new state that had been put in
      this.addPayment(payment, attestation)
    }
  }

  addPayment(payment: PaymentAppState, attestation: Attestation) {
    // If there is an existing payment state, only write over it if the new state
    // would unlock a greater payment amount. This is necessary for securing our payments.
    // Without this check, a longer running query that was scheduled earlier would
    // cancel out payments that were scheduled later but completed first
    const prevState = this.byId.get(payment.paymentId)
    if (prevState != null) {
      if (BigInt(prevState[0].totalPayment) >= BigInt(payment.totalPayment)) {
        return
      }
    }
    this.byId.set(payment.paymentId, [payment, attestation])
    if (prevState == null) {
      this.dirty.push(payment.paymentId)
    }
  }
}

export class PaymentManager implements PaymentManagerInterface {
  wallet: Wallet
  private options: PaymentManagerOptions
  private logger: Logger
  private stateChannels: Map<string, StateChannel>
  private contracts: NetworkContracts
  private sequelize: Sequelize
  private paymentStoreModel: PaymentStoreModel
  private paymentIdToChannel: Map<HexBytes32, StateChannel>

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
    this.options = options
    this.logger = options.logger
    this.stateChannels = new Map()
    this.contracts = options.contracts
    this.sequelize = options.sequelize
    this.paymentStoreModel = options.paymentStoreModel
    this.paymentIdToChannel = new Map()
  }

  createStateChannels(allocations: Allocation[]): Promise<void> {
    const queue = new PQueue({ concurrency: 5 })

    for (const allocation of allocations) {
      queue.add(async () => {
        // TODO: (Zac) LOW This does not account for the possibility of overlapping
        // promises for the same id. Is StateChannel creation idempotent?
        // TODO: (Zac) LOW Consider also that delete may happen while this is being created
        if (!this.stateChannels.has(allocation.id)) {
          const stateChannel = await StateChannel.create({
            ...this.options,
            allocation,
            paymentIdToChannel: this.paymentIdToChannel,
          })

          this.stateChannels.set(allocation.id, stateChannel)
        }
      })
    }

    return queue.onIdle()
  }

  // TODO: (Zac) HIGH Automatically finalize apps with a cap
  // TODO: (Zac) HIGH Automatically finalize apps uninstalled by the gateway

  settleStateChannels(allocations: Allocation[]): Promise<void> {
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

          // TODO: (Zac) HIGH Prevent race conditions here by deleting the channel first,
          // then settling the app, etc?
          this.stateChannels.delete(allocation.id)
        } else {
          this.logger.warn(`Failed to settle state channel: Unknown channel ID`, {
            channelID: allocation.id,
            deployment: allocation.subgraphDeploymentID.display,
            createdAtEpoch: allocation.createdAtEpoch,
          })
        }
      })
    }

    return queue.onIdle()
  }

  // TODO: (Zac) LOW Rename totalPayment to totalPaid
  async lockPayment(payment: UnvalidatedPaymentAppState): Promise<Wallet> {
    if (payment.amount > payment.totalPayment) {
      throw new QueryError('Expected payment to be included in totalPayment')
    }

    // WARN: TODO: MED (Zac) For the first phases of the testnet the Indexer
    // will trust the Consumer, because the Consumer can be a trusted The Graph Gateway.
    // In the future when there are multiple Gateways or Consumers are
    // in-browser wallets there are a number of things that we want to verify:
    //
    // 1. The message is signed by the Consumer, allowing the payment to be unlocked.
    // 2. The paymentId is for an existing and not yet settled app
    // 3. That the totalPayment is monotonically increasing by at least amount
    // 4. That the totalPayment does not exceed the totalCollateralization, (taking
    //    swapRate into account)
    // 5. The amount is at least the price of the query (taking swapRate into account)
    //
    // 3 is tricky, because requests may arrive in parallel, out of order, or even fail.
    // The plan is to have the gateway send out-of-app information that convinces
    // the indexer that all of the queries and payments fit inside a coherent "payment story"
    // that was generated ordered from the Consumer's perspective, but may be unreliable
    // or unordered from the Indexer's. Naive implementations open up the possibility
    // for DOS attacks. For example, a Consumer could leave gaps in the payment history
    // where a query could fit, and thereby leak memory with each query because these
    // gaps have to be tracked. This could be fixed with a max degree of parallelism.
    //
    // 5 might also be tricky. Consider that swapRate is different across the app installs
    // between the different parties. Note from Connext:
    //
    // Gateway-node channel:
    //  - coinTransfers is in Eth/Dai
    //  - totalPaid is in Eth/Dai
    //  - swapRate (in contract) is 1
    // node-Indexer channel:
    //  - coinTransfers is in GRT
    //  - totalPaid is in Eth/Dai
    //  - swapRate(in contract) is Eth:GRT or Dai:GRT

    const stateChannel = this.paymentIdToChannel.get(payment.paymentId)
    if (stateChannel === undefined) {
      throw new QueryError('Unrecognized paymentId')
    }

    // See also: 910e4938-e497-46f6-9f2b-eb8d38b924f0
    // Anything added here needs to be reversed.

    return stateChannel.wallet
  }

  async savePayment(payment: PaymentAppState, attestation: Attestation): Promise<void> {
    const stateChannel = this.paymentIdToChannel.get(payment.paymentId)
    if (stateChannel == null) {
      this.logger.warn('May have dropped payment', { payment, attestation })
      return
    }

    stateChannel.savePayment(payment, attestation)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dropPayment(payment: PaymentAppState): Promise<void> {
    // See also: 910e4938-e497-46f6-9f2b-eb8d38b924f0
    // The method does nothing to lock payments right now,
    // but will in the future. Once it does, that needs to
    // be reversed here.
  }
}

function parse<TIn, TOut>(message: string, value: TIn, parser: (v: TIn) => TOut): TOut {
  try {
    return parser(value)
  } catch {
    throw new QueryError(message, 400)
  }
}

function validate<TIn, TOut extends TIn>(
  message: string,
  value: TIn,
  validator: (v: TIn) => v is TOut,
): TOut {
  if (!validator(value)) {
    throw new QueryError(message)
  }
  return value
}

/**
 * WARN: CWE-20: Improper Input Validation
 */
export function parsePaymentAppState(json: unknown): UnvalidatedPaymentAppState {
  if (json == null) {
    throw new QueryError('No payment provided', 402)
  }

  if (typeof json !== 'string') {
    throw new QueryError('Payment must be provided as single json string', 400)
  }
  const properties = parse('Payment must be a valid json string', json, JSON.parse)

  if (typeof properties !== 'object') {
    throw new QueryError('Payment must be a json object', 400)
  }

  const paymentId = validate(
    'Expecting paymentId to be a 32 byte hex string',
    properties.paymentId,
    validateHexBytes32,
  )

  const signature = validate(
    'Expecting payment signature to be a 65 byte hex string',
    properties.signature,
    validateSignature,
  )

  const totalPayment = parse(
    'Expecting totalPayment to be a valid Uint256',
    properties.totalPayment,
    parseUint256,
  )

  const amount = parse(
    'Expecting payment amount to be a valid Uint256',
    properties.amount,
    parseUint256,
  )

  // This also drops any unknown properties from the value parsed
  const payment: PaymentAppState = {
    paymentId,
    totalPayment,
    signature,
    amount,
  }

  return payment as UnvalidatedPaymentAppState
}
