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
} from '@graphprotocol/common-ts'
import {
  IConnextClient,
  EventPayloads,
  ConditionalTransferTypes,
  PublicParams,
  EventNames,
} from '@connext/types'
import { ChannelSigner, toBN, getPublicIdentifierFromPublicKey } from '@connext/utils'
import { Sequelize, Transaction, Model } from 'sequelize'
import { Wallet, constants, utils, BigNumber } from 'ethers'
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
  info: Allocation
  logger: Logger
  client: IConnextClient
  signer: ChannelSigner
  wallet: Wallet
  contracts: NetworkContracts
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  info: Allocation
}

/**
 * attempts <= 0 retries forever
 */
async function retryWithDelay<T>(attempts: number, f: () => Awaitable<T>): Promise<T> {
  for (; ;) {
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
  info: Allocation
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
      this.handleAppInstall.bind(this)
    )
  }

  /**
   * Creates a StateChannel. The StateChannel may have multiple apps installed on it.
   * Each app may have multiple payments
   */
  static async create({
    info,
    logger: parentLogger,
    sequelize,
    ethereum,
    connextMessaging,
    connextNode,
    connextLogLevel,
    wallet,
    contracts,
  }: StateChannelCreateOptions): Promise<StateChannel> {
    const subgraphDeploymentID = info.subgraphDeploymentID

    const logger = parentLogger.child({
      component: `StateChannel`,
      deployment: subgraphDeploymentID.display,
      createdAtEpoch: info.createdAtEpoch.toString(),
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

      if (client.publicIdentifier !== getPublicIdentifierFromPublicKey(info.publicKey)) {
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
        info,
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

  async handleAppInstall(payload: EventPayloads.ConditionalTransferCreated<unknown>): Promise<void> {
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

    const signedPayload = payload as EventPayloads.GraphBatchedTransferCreated
    payload.

    // Obtain and format transfer amount
    const amount = toBN(payload.amount)
    const formattedAmount = formatGRT(amount)

    this.logger.info(`App installed`, {
      paymentId: payload.paymentId,
      amountGRT: formattedAmount,
      sender: payload.sender,
    })
  }

  // TODO: (Zac) Can't settle app here. No good.
  async settle(): Promise<void> {
    const freeBalance = await this.client.getFreeBalance()
    const balance = freeBalance[this.client.signerAddress]
    const formattedAmount = formatGRT(balance)

    this.logger.info(`Settle channel`, { amountGRT: formattedAmount })

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

  constructor(sequelize: Sequelize, store: PaymentStoreModel) {
    this.store = store
    this.sequelize = sequelize
    this.byId = new Map()
    this.dirty = []
    this.flush()
  }

  // TODO: (Performance) We don't always need to load all fields
  private async loadPaymentState(
    paymentId: HexBytes32,
    transaction?: Transaction,
  ): Promise<CompleteModel<PaymentStore>> {
    const maybe = await this.store.findByPk(
      paymentId,
      { transaction }
    )
    if (maybe == null) {
      throw new QueryError("Unrecognized paymentId")
    }

    // Loading all fields, so this should satisfy the full interface
    return maybe as CompleteModel<PaymentStore>
  }

  private async flushToDisk(payment: PaymentAppState, attestation: Attestation): Promise<void> {
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

        // TODO: (Zac) Ensure we are creating an initial state
        if (prevState == null) {
          throw new QueryError("Unrecognized paymentId")
        }

        if (prevState.totalPayment != null && BigInt(prevState.totalPayment) >= payment.totalPayment) {
          return
        }

        prevState.totalPayment = '0x' + payment.totalPayment.toString(16)
        prevState.consumerSignature = payment.signature
        prevState.attestationSignature = utils.joinSignature(attestation)
        prevState.requestCID = attestation.requestCID

        prevState.save({ transaction })
      })
  }

  private async flush(): Promise<never> {
    for (; ;) {
      // Pop and swap a random dirty entry
      const index = Math.floor(Math.random() * this.dirty.length);
      const dirty = this.dirty[index];
      if (dirty == null) {
        continue
      }
      this.dirty[index] = this.dirty[this.dirty.length - 1]
      this.dirty.pop()
      const data = this.byId.get(dirty);
      if (data == null) {
        continue;
      }
      // This is necessary because addPayment may be called concurrently.
      // Without this line, addPayment would not add the id to the dirty list,
      // and the payment may never flush
      this.byId.delete(dirty)
      const [payment, attestation] = data

      // Flush to disk
      try {
        await this.flushToDisk(payment, attestation)
      } catch (error) {
        // If we fail to save, try again later
        // Calling addPayment again mixes whatever state we took out with
        // any new state that had been put in
        this.addPayment(payment, attestation)
      }

      await delay(1000 / this.dirty.length)
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
  private stateChannels: Map<string, StateChannelInterface>
  private contracts: NetworkContracts
  private sequelize: Sequelize
  private paymentStoreModel: PaymentStoreModel
  private buffer: PaymentStoreBuffer

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
    this.options = options
    this.logger = options.logger
    this.stateChannels = new Map()
    this.contracts = options.contracts
    this.sequelize = options.sequelize
    this.paymentStoreModel = options.paymentStoreModel
    this.buffer = new PaymentStoreBuffer(options.sequelize, options.paymentStoreModel)
  }

  createStateChannels(channels: Allocation[]): Promise<void> {
    const queue = new PQueue({ concurrency: 5 })

    for (const channel of channels) {
      queue.add(async () => {
        // TODO: (Zac) This does not account for the possibility of overlapping
        // promises for the same id. Is StateChannel creation idempotent?
        if (!this.stateChannels.has(channel.id)) {
          const stateChannel = await StateChannel.create({
            ...this.options,
            info: channel,
          })

          this.stateChannels.set(channel.id, stateChannel)
        }
      })
    }

    return queue.onIdle()
  }



  private finalizeApp(finalState: CompleteModel<PaymentStore>) {
    // TODO: (Zac)

    // TODO: (Zac) Upgrade transaction types to serializable

    // TODO: Save finalized

    if (finalState.totalPayment == null) {
      // It is possible that we never served any queries on this channel.
      // In that case, uninstall the app to cancel any payments
      await retryWithDelay(5, () => this.client.uninstallApp(appIdentityHash))
    } else {
      // Make the final move of the game.
      await retryWithDelay(5, () =>
        this.client.resolveCondition({
          conditionType: ConditionalTransferTypes.GraphBatchedTransfer,
          paymentId,
          responseCID: finalPayment.responseCID,
          requestCID: finalPayment.requestCID,
          totalPaid: BigNumber.from(finalPayment.totalAmount),
          consumerSignature: finalPayment.consumerSignature,
          attestationSignature: finalPayment.attestationSignature,
        } as PublicParams.ResolveGraphBatchedTransfer),
      )
    }
  }


  settleStateChannels(channels: Allocation[]): Promise<void> {
    const queue = new PQueue({ concurrency: 5 })

    for (const channel of channels) {
      queue.add(async () => {
        this.logger.info(`Settle state channel`, {
          channelID: channel.id,
          deployment: channel.subgraphDeploymentID.display,
          createdAtEpoch: channel.createdAtEpoch,
        })

        const stateChannel = this.stateChannels.get(channel.id)
        if (stateChannel !== undefined) {

          // TODO: (Zac) Figure out the right way to handle transactions here.
          // We don't want to accept queries while finishing apps,
          // We don't want to install new apps while closing channels,
          // TODO: (Zac) Coordinate with the buffer
          const unfinishedBusiness = await this.paymentStoreModel.findAll({
            where: {
              channelId: channel.id,
              finished: false
            }
          })
          for (const finalState of unfinishedBusiness) {
            this.finalizeApp(finalState as CompleteModel<PaymentStore>)
          }

          await stateChannel.settle()

          // TODO: (Zac) Prevent race conditions here by deleting the channel first,
          // then settling the app, etc?
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

    return queue.onIdle()
  }

  // TODO: (Zac) Rename totalPayment to totalPaid
  async lockPayment(payment: UnvalidatedPaymentAppState): Promise<Wallet> {
    if (payment.amount > payment.totalPayment) {
      throw new QueryError('Expected payment to be included in totalPayment')
    }

    // WARN: TODO: (Zac) For the first phases of the testnet the Indexer
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


    // TODO:
    const stateChannel = this.stateChannels.get(payment.paymentId)
    if (stateChannel === undefined) {
      throw new QueryError('Unrecognized paymentId')
    }

    // See also: 910e4938-e497-46f6-9f2b-eb8d38b924f0
    // Anything added here needs to be reversed.

    return stateChannel.wallet
  }

  async savePayment(payment: PaymentAppState, attestation: Attestation): Promise<void> {
    this.buffer.addPayment(payment, attestation)
  }

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
