import { Logger, Attestation } from '@graphprotocol/common-ts'

import { Wallet } from 'ethers'

import {
  AllocationPaymentClient as AllocationPaymentClientInterface,
  Allocation,
} from './types'

interface AllocationPaymentClientOptions {
    allocation: Allocation
    logger: Logger
    client: null // May re-use these properties
    signer: null // so keeping "null" for now
    wallet: Wallet
  }
  
  export class AllocationPaymentClient implements AllocationPaymentClientInterface {
    allocation: Allocation
    wallet: Wallet
  
    private logger: Logger
    private client: null
    private signer: null
  
    constructor({
      allocation,
      logger,
      client,
      signer,
      wallet,
    }: AllocationPaymentClientOptions) {
      this.allocation = allocation
      this.wallet = wallet
  
      this.logger = logger
      this.client = client
      this.signer = signer
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
  