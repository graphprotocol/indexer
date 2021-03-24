import {
  ConditionalTransferCreatedPayload,
  ConditionalTransferResolvedPayload,
  EngineEvents,
  FullTransferState,
  WithdrawalResolvedPayload,
} from '@connext/vector-types'
import {
  Address,
  formatGRT,
  Logger,
  Metrics,
  NetworkContracts,
  timer,
  toAddress,
} from '@graphprotocol/common-ts'
import { BigNumber, providers, utils, Wallet } from 'ethers'
import { Allocation } from '../allocations'
import { createVectorClient, VectorClient } from './client'
import { AllocationSummary, PaymentModels, Transfer, TransferStatus } from './models'
import { EventCallbackConfig } from '@connext/vector-utils'
import { Evt } from 'evt'
import { DHeap } from '@thi.ng/heaps'
import pRetry from 'p-retry'
import { Transaction, Op, Sequelize } from 'sequelize'
import { indexerError, IndexerErrorCode } from '../errors'

// Transfers that can be resolved are resolved with a delay of 10 minutes
const TRANSFER_RESOLVE_DELAY = 600_000

export interface PaymentsConfig {
  wallet: Wallet
  contracts: NetworkContracts
  nodeUrl: string
  routerIdentifier: string
  vectorTransferDefinition: Address
  eventServer: {
    url: string
    port: string
  }
  models: PaymentModels
}

export interface TransferManagerCreateOptions {
  logger: Logger
  payments: PaymentsConfig
  metrics: Metrics
  ethereum: providers.StaticJsonRpcProvider
  contracts: NetworkContracts
}

interface TransferManagerOptions {
  logger: Logger
  vector: VectorClient
  payments: PaymentsConfig
  contracts: NetworkContracts
}

interface TransferToResolve {
  transfer: Transfer
  timeout: number
}

interface WithdrawableAllocation {
  allocation: Address
  queryFees: string
  withdrawnFees: string
}

export class TransferManager {
  private logger: Logger
  private contracts: NetworkContracts
  private vector: VectorClient
  private vectorTransferDefinition: Address
  private models: PaymentModels

  // Priority queue that orders transfers by the timeout after which
  // they should be resolved
  private transfersToResolve!: DHeap<TransferToResolve>

  private constructor(options: TransferManagerOptions) {
    this.logger = options.logger
    this.contracts = options.contracts
    this.vector = options.vector
    this.models = options.payments.models
    this.vectorTransferDefinition = options.payments.vectorTransferDefinition

    this.startTransferResolutionProcessing()
    this.startWithdrawalProcessing()

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

  static async create(options: TransferManagerCreateOptions): Promise<TransferManager> {
    const logger = options.logger.child({ component: 'TransferManager' })

    // Connect to the vector node
    const evts: Partial<EventCallbackConfig> = {
      [EngineEvents.CONDITIONAL_TRANSFER_CREATED]: {
        evt: Evt.create<ConditionalTransferCreatedPayload>(),
        url: new URL(
          `/${EngineEvents.CONDITIONAL_TRANSFER_CREATED}`,
          options.payments.eventServer.url,
        ).toString(),
      },
      [EngineEvents.CONDITIONAL_TRANSFER_RESOLVED]: {
        evt: Evt.create<ConditionalTransferResolvedPayload>(),
        url: new URL(
          `/${EngineEvents.CONDITIONAL_TRANSFER_RESOLVED}`,
          options.payments.eventServer.url,
        ).toString(),
      },
      [EngineEvents.WITHDRAWAL_RESOLVED]: {
        evt: Evt.create<WithdrawalResolvedPayload>(),
        url: new URL(
          `/${EngineEvents.WITHDRAWAL_RESOLVED}`,
          options.payments.eventServer.url,
        ).toString(),
      },
    }

    // Connect to the vector node for withdrawing query fees into the
    // rebate pool when allocations are closed
    const vector = await createVectorClient({
      logger,
      metrics: options.metrics,
      ethereum: options.ethereum,
      contracts: options.payments.contracts,
      wallet: options.payments.wallet,
      nodeUrl: options.payments.nodeUrl,
      routerIdentifier: options.payments.routerIdentifier,
      eventServer: {
        ...options.payments.eventServer,
        evts,
      },
    })

    return new TransferManager({
      logger,
      vector,
      payments: options.payments,
      contracts: options.contracts,
    })
  }

  private startTransferResolutionProcessing() {
    this.transfersToResolve = new DHeap<TransferToResolve>(null, {
      compare: (t1, t2) => t1.timeout - t2.timeout,
    })

    // Check if there's another transfer to resolve every 10s
    timer(10_000).pipe(async () => {
      while (this.transfersToResolve.length > 0) {
        // Check whether the next transfer's timeout has expired
        let transfer = this.transfersToResolve.peek()
        if (transfer && transfer.timeout <= Date.now()) {
          // Remove the transfer from the processing queue
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          transfer = this.transfersToResolve.pop()!

          // Resolve the transfer now
          await this.resolveTransfer(transfer.transfer)
        }
      }
    })
  }

  private startWithdrawalProcessing() {
    timer(30_000).pipe(async () => {
      const withdrawableAllocations = await this.withdrawableAllocations()
      for (const withdrawableAllocation of withdrawableAllocations) {
        await this.withdrawAllocation(withdrawableAllocation)
      }
    })
  }

  public async queuePendingTransfersFromDatabase(): Promise<void> {
    let transfers
    try {
      // Fetch all resolvable transfers from the db and put them into the
      // processing queue
      transfers = await this.models.transfers.findAll({
        where: { status: TransferStatus.ALLOCATION_CLOSED },
      })
    } catch (err) {
      this.logger.error(`Failed to query transfers to resolve`, {
        err: indexerError(IndexerErrorCode.IE041, err),
      })
      return
    }

    for (const transfer of transfers) {
      this.transfersToResolve.push({
        transfer,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        timeout: transfer.allocationClosedAt!.valueOf() + TRANSFER_RESOLVE_DELAY,
      })
    }
  }

  private isGraphTransfer(transfer: FullTransferState): boolean {
    const eventTransferDefinition = toAddress(transfer.transferDefinition)
    if (eventTransferDefinition !== this.vectorTransferDefinition) {
      this.logger.warn(`Non-Graph transfer detected`, {
        eventTransferDefinition,
        expectedTransferDefinition: this.vectorTransferDefinition,
      })
      return false
    }
    return true
  }

  private async ensureAllocationSummary(
    allocation: Address,
    transaction: Transaction,
  ): Promise<AllocationSummary> {
    const [summary] = await this.models.allocationSummaries.findOrBuild({
      where: { allocation },
      defaults: {
        allocation,
        closedAt: null,
        createdTransfers: 0,
        resolvedTransfers: 0,
        failedTransfers: 0,
        openTransfers: 0,
        queryFees: '0',
        withdrawnFees: '0',
      },
      transaction,
    })
    return summary
  }

  private async handleTransferCreated(payload: ConditionalTransferCreatedPayload) {
    // Ignore non-Graph transfers
    if (!this.isGraphTransfer(payload.transfer)) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { routingId, allocation } = payload.transfer.meta!
    const signer = payload.transfer.transferState.signer

    this.logger.info(`Add transfer to the database`, {
      routingId,
      allocation,
      signer,
    })

    const transact = () =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.models.transfers.sequelize!.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
        async (transaction) => {
          // Update the allocation summary
          const summary = await this.ensureAllocationSummary(allocation, transaction)
          summary.createdTransfers += 1
          summary.openTransfers += 1
          await summary.save({ transaction })

          // Add the transfer itself
          await this.models.transfers.create(
            {
              signer,
              allocation,
              routingId: routingId,
              status: TransferStatus.OPEN,
              allocationClosedAt: null,
            },
            { transaction },
          )
        },
      )

    try {
      await pRetry(
        async () => {
          try {
            await transact()
          } catch (err) {
            // Only retry if the error is:
            //   40001: 'could not serialize access due to concurrent update'
            //      This happens when 2 transfer creations write to the allocation summary at the same time.
            //   23505: 'duplicate key value violates unique constraint "allocation_summaries_pkey"',
            //      This happens for the same as above, except that it creates the allocation summary.
            const code = err.parent.code
            if (!['40001', '23505'].includes(code)) {
              throw new pRetry.AbortError(err)
            }
          }
        },
        { retries: 20 },
      )
    } catch (err) {
      this.logger.error(`Failed to add transfer to the database`, {
        routingId,
        allocation,
        signer,
        err: indexerError(IndexerErrorCode.IE042, err),
      })
      return
    }
  }

  private async handleTransferResolved(payload: ConditionalTransferResolvedPayload) {
    // Ignore non-Graph transfers
    if (!this.isGraphTransfer(payload.transfer)) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { routingId, allocation } = payload.transfer.meta!
    const signer = payload.transfer.transferState.signer

    this.logger.info(`Mark transfer as resolved`, {
      routingId,
      allocation,
    })

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.transfers.sequelize!.transaction(async (transaction) => {
        // Mark the transfer as resolved
        await this.models.transfers.update(
          { status: TransferStatus.RESOLVED },
          { where: { routingId }, transaction },
        )

        // Remove all its receipts (cleanup)
        await this.models.receipts.destroy({
          where: { signer },
          transaction,
        })

        // Update allocation summary
        const summary = await this.ensureAllocationSummary(allocation, transaction)
        summary.resolvedTransfers += 1
        summary.openTransfers -= 1
        summary.queryFees = BigNumber.from(summary.queryFees)
          .add(payload.transfer.balance.amount[1])
          .toString()
        await summary.save({ transaction })
      })
    } catch (err) {
      this.logger.error(`Failed to mark transfer as resolved`, {
        routingId,
        err: indexerError(IndexerErrorCode.IE043, err),
      })
    }
  }

  private async handleWithdrawalResolved(payload: WithdrawalResolvedPayload) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { allocation, queryFees } = payload.transfer.meta!

    let success = false
    try {
      success = await pRetry(
        async () => {
          this.logger.debug(`Collecting query fees via the rebate pool`, {
            allocation,
            queryFees: formatGRT(queryFees),
          })

          // Estimate gas and add some buffer (like we do in network.ts)
          const gasLimit = await this.vector.wallet.estimateGas(payload.transaction)
          const gasLimitWithBuffer = Math.ceil(gasLimit.toNumber() * 1.5)

          // Submit the transaction and wait for 2 confirmations
          // TODO: Use the robust transaction management from
          // https://github.com/graphprotocol/indexer/pull/212
          // when it is ready
          const tx = await this.vector.wallet.sendTransaction({
            ...payload.transaction,
            value: 0, // We're not sending any ETH
            gasLimit: gasLimitWithBuffer,
          })
          await tx.wait(2)

          return true
        },
        { retries: 2 },
      )
    } catch (err) {
      this.logger.error(`Failed to collect query fees on chain`, {
        allocation,
        queryFees,
        err: indexerError(IndexerErrorCode.IE044, err),
      })
    }

    if (success) {
      try {
        // Delete all transfers for the allocation (cleanup)
        await this.models.transfers.destroy({
          where: { allocation, status: { [Op.not]: TransferStatus.OPEN } },
        })
      } catch (err) {
        this.logger.error(`Failed to clean up transfers for allocation`, {
          allocation,
          err: indexerError(IndexerErrorCode.IE049),
        })
      }
    }
  }

  async withdrawableAllocations(): Promise<WithdrawableAllocation[]> {
    return await this.models.allocationSummaries.findAll({
      where: {
        // In order to be withdrawable, allocations must be closed...
        closedAt: { [Op.not]: null },

        // ...they must have some unwithdrawn query fees...
        queryFees: { [Op.gt]: Sequelize.col('withdrawnFees') },

        // ...they must have seen at least one transfer...
        createdTransfers: { [Op.gt]: 0 },

        // ...and all transfers must have been resolved or failed.
        openTransfers: { [Op.lte]: 0 },
      },

      // Return and start withdrawing the most valuable allocations first
      order: [['queryFees', 'DESC']],
    })
  }

  async hasUnresolvedTransfers(allocation: Allocation): Promise<boolean> {
    const unresolvedTransfers = await this.models.transfers.count({
      include: [this.models.transfers.associations.receipts],
      where: {
        allocation: allocation.id,
        status: [TransferStatus.OPEN, TransferStatus.ALLOCATION_CLOSED],
      },
    })
    return unresolvedTransfers > 0
  }

  async unresolvedTransfersWithReceipts(
    allocation: Allocation,
    transaction: Transaction,
  ): Promise<Transfer[]> {
    return await this.models.transfers.findAll({
      include: [this.models.transfers.associations.receipts],
      where: {
        allocation: allocation.id,
        status: [TransferStatus.OPEN, TransferStatus.ALLOCATION_CLOSED],
      },
      order: [[this.models.transfers.associations.receipts, 'id', 'ASC']],
      transaction,
    })
  }

  async markAllocationAsClosed(allocation: Allocation): Promise<boolean> {
    try {
      const now = new Date()

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const unresolvedTransfers = await this.models.transfers.sequelize!.transaction(
        async (transaction) => {
          // Mark all transfers for the allocation as closed
          await this.models.transfers.update(
            { status: TransferStatus.ALLOCATION_CLOSED, allocationClosedAt: now },
            {
              where: {
                allocation: allocation.id,
                status: [TransferStatus.OPEN],
              },
              transaction,
            },
          )

          // Update the allocation summary
          await this.models.allocationSummaries.update(
            { closedAt: now },
            { where: { allocation: allocation.id }, transaction },
          )

          // Fetch all transfers for the allocation that have the status
          // OPEN or ALLOCATION_CLOSED and still need to be resolved
          return await this.unresolvedTransfersWithReceipts(allocation, transaction)
        },
      )

      // Resolve transfers with a delay
      for (const transfer of unresolvedTransfers) {
        this.transfersToResolve.push({
          transfer,
          timeout: now.valueOf() + TRANSFER_RESOLVE_DELAY,
        })
      }
      return true
    } catch (err) {
      this.logger.error(`Failed to queue transfers for resolving`, {
        allocation: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        err: indexerError(IndexerErrorCode.IE045, err),
      })
      return false
    }
  }

  async resolveTransfer(transfer: Transfer): Promise<void> {
    const { routingId, allocation } = transfer

    this.logger.info(`Resolve transfer`, { routingId, allocation })

    let failed = false
    try {
      const transferResult = await this.vector.node.getTransferByRoutingId({
        channelAddress: this.vector.channelAddress,
        routingId: transfer.routingId,
      })
      if (transferResult.isError) {
        throw transferResult.getError()
      }

      const vectorTransfer = transferResult.getValue()
      if (!vectorTransfer) {
        throw new Error(`Transfer not found`)
      }

      const result = await this.vector.node.resolveTransfer({
        channelAddress: this.vector.channelAddress,
        transferId: vectorTransfer.transferId,
        transferResolver: {
          receipts: (transfer.receipts || []).map((receipt) => ({
            id: receipt.id,
            amount: receipt.paymentAmount.toString(),
            signature: receipt.signature,
          })),
        },
      })

      if (result.isError) {
        throw result.getError()
      }
    } catch (err) {
      this.logger.error(`Failed to resolve transfer`, {
        routingId,
        allocation,
        err: indexerError(IndexerErrorCode.IE046, err),
      })
      failed = true
    }

    if (failed) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.models.transfers.sequelize!.transaction(async (transaction) => {
          // Update transfer in the db
          await this.models.transfers.update(
            { status: TransferStatus.FAILED },
            { where: { routingId }, transaction },
          )

          // Update allocation summary
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const summary = (await this.models.allocationSummaries.findOne({
            where: { allocation },
          }))!
          summary.failedTransfers += 1
          summary.openTransfers -= 1
          await summary.save({ transaction })
        })
      } catch (err) {
        this.logger.critical(`Failed to mark transfer as failed`, {
          routingId,
          allocation,
          err: indexerError(IndexerErrorCode.IE047, err),
        })
      }
    }
  }

  public async withdrawAllocation(withdrawal: WithdrawableAllocation): Promise<void> {
    const withdrawnFees = BigNumber.from(withdrawal.withdrawnFees)
    const feesToWithdraw = BigNumber.from(withdrawal.queryFees).sub(
      withdrawal.withdrawnFees,
    )

    this.logger.info(`Withdraw query fees for allocation`, {
      allocation: withdrawal.allocation,
      queryFees: withdrawal.queryFees,
      withdrawnFees: withdrawal.withdrawnFees.toString(),
      feesToWithdraw: feesToWithdraw.toString(),
    })

    try {
      // Update the withdrawn fees
      await this.models.allocationSummaries.update(
        { withdrawnFees: withdrawnFees.add(feesToWithdraw).toString() },
        { where: { allocation: withdrawal.allocation } },
      )

      const encoding = 'tuple(address staking,address allocationID)'
      const data = {
        staking: this.contracts.staking.address,
        allocationID: withdrawal.allocation,
      }
      const callData = utils.defaultAbiCoder.encode([encoding], [data])
      const result = await this.vector.node.withdraw({
        channelAddress: this.vector.channelAddress,
        assetId: this.contracts.token.address,
        amount: feesToWithdraw.toString(),
        recipient: '0xE5Fa88135c992A385aAa1C65A0c1b8ff3FdE1FD4',
        callTo: '0xE5Fa88135c992A385aAa1C65A0c1b8ff3FdE1FD4',
        callData,
        initiatorSubmits: true,
        meta: {
          allocation: withdrawal.allocation,
          queryFees: feesToWithdraw,
        },
      })

      if (result.isError) {
        const err = result.getError()
        this.logger.error(`Failed to withdraw`, {
          channelAddress: this.vector.channelAddress,
          amount: withdrawal.queryFees.toString(),
          callTo: '0xE5Fa88135c992A385aAa1C65A0c1b8ff3FdE1FD4',
          callData,
          err,
        })
        throw err
      }
    } catch (err) {
      this.logger.error(`Failed to withdraw query fees for allocation`, {
        allocation: withdrawal.allocation,
        queryFees: withdrawal.queryFees.toString(),
        err: indexerError(IndexerErrorCode.IE048, err),
      })
    }
  }
}
