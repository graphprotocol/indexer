import { Logger, Metrics } from '@graphprotocol/common-ts'

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
  wallet: Wallet
}

export interface PaymentManagerCreateOptions {
  logger: Logger
  metrics: Metrics
}

export class PaymentManager implements PaymentManagerInterface {
  wallet: Wallet

  private logger: Logger
  private allocationClients: Map<string, AllocationPaymentClientInterface>

  constructor(options: PaymentManagerOptions) {
    this.wallet = options.wallet
    this.logger = options.logger
    this.allocationClients = new Map()
  }

  createAllocationPaymentClients(allocations: Allocation[]): void {
    for (const allocation of allocations) {
      if (!this.allocationClients.has(allocation.id))
        this.allocationClients.set(
          allocation.id,
          new AllocationPaymentClient({
            wallet: this.wallet,
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

  getAllocationPaymentClient(
    allocationId: string,
  ): AllocationPaymentClientInterface | undefined {
    return this.allocationClients.get(allocationId)
  }
}
