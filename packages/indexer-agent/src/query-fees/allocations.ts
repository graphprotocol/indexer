import axios from 'axios'
import {
  Address,
  Logger,
  timer,
  BytesWriter,
  toAddress,
  formatGRT,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationReceipt,
  AllocationSummary,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  Voucher,
} from '@graphprotocol/indexer-common'
import { DHeap } from '@thi.ng/heaps'
import { ReceiptCollector } from '.'
import { BigNumber, Contract } from 'ethers'
import { Op, Transaction } from 'sequelize'
import { Network } from '../network'

// Receipts are collected with a delay of 20 minutes after
// the corresponding allocation was closed
const RECEIPT_COLLECT_DELAY = 1200_000

interface AllocationReceiptsBatch {
  receipts: AllocationReceipt[]
  timeout: number
}

export interface AllocationReceiptCollectorOptions {
  logger: Logger
  network: Network
  models: QueryFeeModels
  collectEndpoint: URL
  allocationExchange: Contract
}

export class AllocationReceiptCollector implements ReceiptCollector {
  private logger: Logger
  private models: QueryFeeModels
  private network: Network
  private allocationExchange: Contract
  private collectEndpoint: URL
  private receiptsToCollect!: DHeap<AllocationReceiptsBatch>

  constructor({
    logger,
    network,
    models,
    collectEndpoint,
    allocationExchange,
  }: AllocationReceiptCollectorOptions) {
    this.logger = logger.child({ component: 'AllocationReceiptCollector' })
    this.network = network
    this.models = models
    this.collectEndpoint = collectEndpoint
    this.allocationExchange = allocationExchange

    this.startReceiptCollecting()
    this.startVoucherProcessing()
  }

  async rememberAllocations(allocations: Allocation[]): Promise<boolean> {
    const logger = this.logger.child({
      allocations: allocations.map(allocation => allocation.id),
    })

    try {
      logger.info('Remember allocations for collecting receipts later')

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async transaction => {
          for (const allocation of allocations) {
            const summary = await this.ensureAllocationSummary(
              allocation.id,
              transaction,
            )
            await summary.save()
          }
        },
      )
      return true
    } catch (err) {
      logger.error(
        `Failed to remember allocations for collecting receipts later`,
        {
          err: indexerError(IndexerErrorCode.IE056, err),
        },
      )
      return false
    }
  }

  async collectReceipts(allocation: Allocation): Promise<boolean> {
    const logger = this.logger.child({
      allocation: allocation.id,
      deployment: allocation.subgraphDeployment.id.display,
    })

    try {
      logger.info(`Queue allocation receipts for collecting`)

      const now = new Date()

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const receipts = await this.models.allocationReceipts.sequelize!.transaction(
        async transaction => {
          // Update the allocation summary
          await this.models.allocationSummaries.update(
            { closedAt: now },
            {
              where: { allocation: allocation.id },
              transaction,
            },
          )

          // Return all receipts for the just-closed allocation
          return this.models.allocationReceipts.findAll({
            where: { allocation: allocation.id },
            transaction,
          })
        },
      )

      if (receipts.length <= 0) {
        logger.info(`No receipts to collect for allocation`)
      } else {
        const timeout = now.valueOf() + RECEIPT_COLLECT_DELAY

        // Collect the receipts for this allocation in a bit
        this.receiptsToCollect.push({
          receipts,
          timeout,
        })
        logger.info(`Successfully queued allocation receipts for collecting`, {
          receipts: receipts.length,
          timeout: new Date(timeout).toLocaleString(),
        })
      }

      return true
    } catch (err) {
      logger.error(`Failed to queue allocation receipts for collecting`, {
        err: indexerError(IndexerErrorCode.IE053, err),
      })
      return false
    }
  }

  private startReceiptCollecting() {
    this.receiptsToCollect = new DHeap<AllocationReceiptsBatch>(null, {
      compare: (t1, t2) => t1.timeout - t2.timeout,
    })

    // Check if there's another batch of receipts to collect every 10s
    timer(10_000).pipe(async () => {
      while (this.receiptsToCollect.length > 0) {
        // Check whether the next receipts batch timeout has expired
        let batch = this.receiptsToCollect.peek()
        if (batch && batch.timeout <= Date.now()) {
          // Remove the batch from the processing queue
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          batch = this.receiptsToCollect.pop()!

          // If the array is empty we cannot know what allocation this group
          // belongs to. Should this assertion ever fail, then there is a
          // programmer error where empty batches are pushed to the
          // `receiptsToCollect` queue.
          console.assert(batch.receipts.length > 0)

          // Collect the receipts now
          await this.obtainReceiptsVoucher(batch.receipts)
        }
      }
    })
  }

  private startVoucherProcessing() {
    timer(30_000).pipe(async () => {
      const pendingVouchers = await this.pendingVouchers()
      for (const voucher of pendingVouchers) {
        await this.submitVoucher(voucher)
      }
    })
  }

  private async pendingVouchers(): Promise<Voucher[]> {
    return this.models.vouchers.findAll()
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

  private async obtainReceiptsVoucher(
    receipts: AllocationReceipt[],
  ): Promise<void> {
    const logger = this.logger.child({
      allocation: receipts[0].allocation,
    })

    try {
      logger.info(`Collect receipts for allocation`, {
        receipts: receipts.length,
      })

      // Encode the receipt batch to a buffer
      // [allocationId, receipts[]] (in bytes)
      const encodedReceipts = new BytesWriter(20 + receipts.length * 112)
      encodedReceipts.writeHex(receipts[0].allocation)
      for (const receipt of receipts) {
        // [fee, id, signature]
        const fee = BigNumber.from(receipt.paymentAmount).toHexString()
        const feePadding = 33 - fee.length / 2
        encodedReceipts.writeZeroes(feePadding)
        encodedReceipts.writeHex(fee)
        encodedReceipts.writeHex(receipt.id)
        encodedReceipts.writeHex(receipt.signature)
      }

      // Exhcange the receipts for a voucher signed by the counterparty (aka the client)
      const response = await axios.post(
        this.collectEndpoint.toString(),
        encodedReceipts.unwrap().buffer,
      )
      const voucher = response.data as {
        allocation: string
        amount: string
        signature: string
      }

      // Replace the receipts with the voucher in one db transaction;
      // should this fail, we'll try to collect these receipts again
      // later
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.vouchers.sequelize!.transaction(async transaction => {
        logger.debug(`Removing collected receipts from the database`, {
          receipts: receipts.length,
        })

        // Remove all receipts in the batch from the database
        await this.models.allocationReceipts.destroy({
          where: {
            id: receipts.map(receipt => receipt.id),
          },
          transaction,
        })

        logger.debug(
          `Add voucher received in exchange for receipts to the database`,
        )

        // Update the query fees tracked against the allocation
        const summary = await this.ensureAllocationSummary(
          toAddress(voucher.allocation),
          transaction,
        )
        summary.queryFees = BigNumber.from(summary.queryFees)
          .add(voucher.amount)
          .toString()
        await summary.save({ transaction })

        // Add the voucher to the database
        await this.models.vouchers.findOrBuild({
          where: { allocation: voucher.allocation },
          defaults: {
            allocation: toAddress(voucher.allocation),
            amount: voucher.amount,
            signature: voucher.signature,
          },
          transaction,
        })
      })
    } catch (err) {
      logger.error(
        `Failed to collect receipts in exchange for an on-chain query fee voucher`,
        { err: indexerError(IndexerErrorCode.IE054, err) },
      )
    }
  }

  private async submitVoucher(voucher: Voucher): Promise<void> {
    const logger = this.logger.child({
      allocation: voucher.allocation,
      amount: formatGRT(voucher.amount),
    })

    logger.info(`Redeem query fee voucher on chain`)

    // Check if a voucher for this allocation was already redeemed
    if (await this.allocationExchange.allocationsRedeemed(voucher.allocation)) {
      logger.warn(
        `Query fee voucher for allocation already redeemed, delete local voucher copy`,
      )

      try {
        await this.models.vouchers.destroy({
          where: { allocation: voucher.allocation },
        })
      } catch (err) {
        logger.warn(
          `Failed to delete local voucher copy, will try again later`,
          { err },
        )
      }
      return
    }

    try {
      // Submit the voucher on chain
      const txReceipt = await this.network.executeTransaction(
        () =>
          this.allocationExchange.estimateGas.redeem(
            voucher.allocation,
            voucher.amount,
            voucher.signature,
          ),
        async gasLimit =>
          this.allocationExchange.redeem(
            voucher.allocation,
            voucher.amount,
            voucher.signature,
            { gasLimit },
          ),
        logger.child({ action: 'redeem' }),
      )

      if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async transaction => {
          const summary = await this.ensureAllocationSummary(
            toAddress(voucher.allocation),
            transaction,
          )
          summary.withdrawnFees = BigNumber.from(summary.withdrawnFees)
            .add(voucher.amount)
            .toString()
          await summary.save()
        },
      )
    } catch (err) {
      logger.error(`Failed to redeem query fee voucher`, {
        err: indexerError(IndexerErrorCode.IE055, err),
      })
      return
    }

    // Remove the now obsolete voucher from the database
    logger.info(`Successfully redeemed query fee voucher, delete local copy`)
    try {
      await this.models.vouchers.destroy({
        where: { allocation: voucher.allocation },
      })
      logger.info(`Successfully deleted local voucher copy`)
    } catch (err) {
      logger.warn(`Failed to delete local voucher copy, will try again later`, {
        err,
      })
    }
  }

  public async queuePendingReceiptsFromDatabase(): Promise<void> {
    // Obtain all closed allocations
    const closedAllocations = await this.models.allocationSummaries.findAll({
      where: { closedAt: { [Op.not]: null } },
    })

    // Create a receipts batch for each of these allocations
    const batches = new Map<string, AllocationReceiptsBatch>(
      closedAllocations.map(summary => [
        summary.allocation,
        {
          timeout: summary.closedAt.valueOf() + RECEIPT_COLLECT_DELAY,
          receipts: [],
        },
      ]),
    )

    // Obtain all receipts for these allocations
    const uncollectedReceipts = await this.models.allocationReceipts.findAll({
      where: {
        allocation: closedAllocations.map(summary => summary.allocation),
      },
    })

    // Add receipts into the right batches
    for (const receipt of uncollectedReceipts) {
      const batch = batches.get(receipt.allocation)

      // We can safely assume that we only fetched receipts matching the
      // allocations; just asserting this here to be _really_ sure
      console.assert(batch !== undefined)
      batch?.receipts.push(receipt)
    }

    // Queue all batches of uncollected receipts
    for (const batch of batches.values()) {
      if (batch.receipts.length > 0) {
        this.logger.info(
          `Queue allocation receipts for collecting again after a restart`,
          {
            allocation: batch.receipts[0].allocation,
            receipts: batch.receipts.length,
          },
        )
        this.receiptsToCollect.push(batch)
      }
    }
  }
}
