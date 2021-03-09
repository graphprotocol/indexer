import {
  ConditionalTransferCreatedPayload,
  ConditionalTransferResolvedPayload,
  EngineEvents,
  WithdrawalResolvedPayload,
} from '@connext/vector-types'
import { Address, Logger, toAddress } from '@graphprotocol/common-ts'
import { BigNumber, Wallet } from 'ethers'
import { Allocation } from '../allocations'
import { VectorClient } from './client'
import { PaymentModels, Transfer } from './models'
import pRetry from 'p-retry'

export interface TransferManagerOptions {
  logger: Logger
  vector: VectorClient
  vectorTransferDefinition: Address
  models: PaymentModels
  wallet: Wallet
}

export class TransferManager {
  private logger: Logger
  private vector: VectorClient
  private vectorTransferDefinition: Address
  private models: PaymentModels
  private wallet: Wallet

  constructor(options: TransferManagerOptions) {
    this.logger = options.logger.child({ component: 'TransferManager' })
    this.vector = options.vector
    this.models = options.models
    this.vectorTransferDefinition = options.vectorTransferDefinition
    this.wallet = options.wallet

    this.vector.node.on(
      EngineEvents.CONDITIONAL_TRANSFER_CREATED,
      this.handleTransferCreated.bind(this),
      undefined,
      this.vector.node.publicIdentifier,
    )

    this.vector.node.on(
      EngineEvents.CONDITIONAL_TRANSFER_RESOLVED,
      this.handleTransferResolved.bind(this),
      undefined,
      this.vector.node.publicIdentifier,
    )

    this.vector.node.on(
      EngineEvents.WITHDRAWAL_RESOLVED,
      this.handleWithdrawalResolved.bind(this),
      undefined,
      this.vector.node.publicIdentifier,
    )
  }

  private async handleTransferCreated(payload: ConditionalTransferCreatedPayload) {
    // Ignore non-Graph transfers
    const eventTransferDefinition = toAddress(payload.transfer.transferDefinition)
    if (eventTransferDefinition !== this.vectorTransferDefinition) {
      this.logger.warn(`Non-Graph transfer resolved`, {
        eventTransferDefinition,
        expectedTransferDefinition: this.vectorTransferDefinition,
      })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const routingId = payload.transfer.meta!.routingId
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const allocation = payload.transfer.meta!.allocation
    const signer = payload.transfer.transferState.signer

    this.logger.info(`Add new transfer to the db`, {
      routingId,
      allocation,
      signer,
    })

    try {
      await this.models.transfers.create({
        signer,
        allocation,
        routingId: routingId,
        isResolved: false,
      })
    } catch (err) {
      this.logger.error(`Failed to add new transfer to the db`, {
        routingId,
        allocation,
        signer,
        err,
      })
    }
  }

  private async handleTransferResolved(payload: ConditionalTransferResolvedPayload) {
    // Ignore non-Graph transfers
    const eventTransferDefinition = toAddress(payload.transfer.transferDefinition)
    if (eventTransferDefinition !== this.vectorTransferDefinition) {
      this.logger.warn(`Non-Graph transfer resolved`, {
        eventTransferDefinition,
        expectedTransferDefinition: this.vectorTransferDefinition,
      })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const routingId = payload.transfer.meta!.routingId

    this.logger.info(`Mark transfer as resolved in the db`, { routingId })

    try {
      await this.models.transfers.update({ isResolved: true }, { where: { routingId } })
    } catch (err) {
      this.logger.error(`Failed to mark transfer as resolved in the db`, {
        routingId,
        err,
      })
    }
  }

  private async handleWithdrawalResolved(payload: WithdrawalResolvedPayload) {
    // TODO: Use the robust transaction management from
    // https://github.com/graphprotocol/indexer/pull/212
    // when it is ready

    try {
      await pRetry(
        async () => {
          this.logger.debug(`Collecting query fees via the rebate pool`, {
            amount: payload.transaction.value,
          })

          // Estimate gas and add some buffer (like we do in network.ts)
          const gasLimit = await this.wallet.estimateGas(payload.transaction)
          const gasLimitWithBuffer = Math.ceil(gasLimit.toNumber() * 1.5)

          // Submit the transaction and wait for 2 confirmations
          const tx = await this.wallet.sendTransaction({
            ...payload.transaction,
            value: '0', // We're not sending any ETH
            gasLimit: gasLimitWithBuffer,
          })
          await tx.wait(2)
        },
        { retries: 2 },
      )
    } catch (err) {
      // FIXME: Add indexerError for this
      this.logger.error(`Failed to collect query fes via the rebate pool`, {
        err,
      })
    }
  }

  async hasUnresolvedTransfers(allocation: Allocation): Promise<boolean> {
    const unresolvedTransfers = await this.models.transfers.count({
      include: [this.models.transfers.associations.receipts],
      where: {
        allocation: allocation.id,
        isResolved: false,
      },
    })
    return unresolvedTransfers > 0
  }

  async unresolvedTransfersAndReceipts(allocation: Allocation): Promise<Transfer[]> {
    return await this.models.transfers.findAll({
      include: [this.models.transfers.associations.receipts],
      where: {
        allocation: allocation.id,
        isResolved: false,
      },
      order: [[this.models.transfers.associations.receipts, 'id', 'ASC']],
    })
  }

  async resolveTransfer(transfer: Transfer): Promise<void> {
    const transferResult = await this.vector.node.getTransferByRoutingId({
      channelAddress: this.vector.channelAddress,
      routingId: transfer.routingId,
    })
    if (transferResult.isError) {
      throw transferResult.getError()
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const vectorTransfer = transferResult.getValue()!

    const result = await this.vector.node.resolveTransfer({
      channelAddress: this.vector.channelAddress,
      transferId: vectorTransfer?.transferId,
      transferResolver: {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        receipts: transfer.receipts!.map((receipt) => ({
          id: receipt.id,
          amount: receipt.paymentAmount.toString(),
          signature: receipt.signature,
        })),
      },
    })

    if (result.isError) {
      throw result.getError()
    }
  }
}
