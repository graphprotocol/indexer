import { Logger, Metrics, NetworkContracts } from '@graphprotocol/common-ts'

import { Sequelize } from 'sequelize'
import { Wallet } from 'ethers'

import {
  PaymentManager as PaymentManagerInterface,
  AllocationPaymentClient as AllocationPaymentClientInterface,
  Allocation,
} from './types'
import { AllocationPaymentClient } from './allocation-client'

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
  private allocationClients: Map<string, AllocationPaymentClientInterface>
  private contracts: NetworkContracts

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
    this.options = options
    this.logger = options.logger
    this.allocationClients = new Map()
    this.contracts = options.contracts
  }

  createAllocationPaymentClients(allocations: Allocation[]): void {
    for (const allocation of allocations) {
      if (!this.allocationClients.has(allocation.id))
        this.allocationClients.set(
          allocation.id,
          new AllocationPaymentClient({
            ...this.options,
            logger: this.logger.child({ allocationId: allocation.id }),
            allocation,
            client: null,
            signer: null,
          }),
        )
    }
  }

  async collectAllocationPayments(allocations: Allocation[]): Promise<void> {
    await Promise.all(
      allocations.map(async ({ id, subgraphDeploymentID, createdAtEpoch }) => {
        this.logger.info(`Collecting allocation payments`, {
          createdAtEpoch,
          allocationId: id,
          deployment: subgraphDeploymentID.display,
        })

        const allocationClient = this.allocationClients.get(id)

        if (typeof allocationClient === 'undefined')
          return this.logger.warn(`Failed to collect payments: Unknown allocation ID`, {
            createdAtEpoch,
            allocationId: id,
            deployment: subgraphDeploymentID.display,
          })

        await allocationClient.settle()
        this.allocationClients.delete(id)
      }),
    )
  }

  getAllocationPaymentClient(id: string): AllocationPaymentClientInterface | undefined {
    return this.allocationClients.get(id)
  }
}
