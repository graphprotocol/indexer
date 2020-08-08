import { Logger, Attestation, Metrics, NetworkContracts } from '@graphprotocol/common-ts'
import { Sequelize } from 'sequelize'
import { Wallet } from 'ethers'
import PQueue from 'p-queue'

import {
  PaymentManager as PaymentManagerInterface,
  AllocationPaymentClient as StateChannelInterface,
  Allocation,
} from './types'

interface StateChannelOptions {
  allocation: Allocation
  logger: Logger
  client: null // May re-use these properties
  signer: null // so keeping "null" for now
  wallet: Wallet
  contracts: NetworkContracts
}

interface StateChannelCreateOptions extends PaymentManagerOptions {
  allocation: Allocation
}

export class StateChannel implements StateChannelInterface {
  allocation: Allocation
  wallet: Wallet
  contracts: NetworkContracts

  private logger: Logger
  private client: null
  private signer: null

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

    this.logger = logger
    this.client = client
    this.signer = signer
  }

  static async create({
    allocation,
    logger: parentLogger,
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

    logger.debug(`Allocation configuration`, {
      onChainSignerAddress: allocation.id,
    })

    logger.info(`Created state channel successfully`)

    return new StateChannel({
      wallet,
      allocation: allocation,
      logger: logger.child({ allocationId: allocation.id }),
      client: null,
      signer: null,
      contracts,
    })
  }

  async unlockPayment(
    // eslint-disable-next-line
    attestation: Attestation,
  ): Promise<string> {
    // TODO: (Liam) Update the state channel and return the new state to send back to the consumer
    throw new Error('Unimplemented - unlockPayment')
  }

  async settle(): Promise<void> {
    // tell state channels wallet to closeChannel
  }
}

interface PaymentManagerOptions {
  logger: Logger
  metrics: Metrics
  sequelize: Sequelize
  ethereum: string
  wallet: Wallet
  contracts: NetworkContracts
}

export interface PaymentManagerCreateOptions {
  logger: Logger
  metrics: Metrics
}

export class PaymentManager implements PaymentManagerInterface {
  wallet: Wallet

  private options: PaymentManagerOptions
  private logger: Logger
  private stateChannels: Map<string, StateChannelInterface>
  private contracts: NetworkContracts

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
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
