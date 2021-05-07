import axios from 'axios'
import { Logger, timer, BytesWriter, toAddress } from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationReceipt,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  Voucher,
} from '@graphprotocol/indexer-common'
import { DHeap } from '@thi.ng/heaps'
import { ReceiptCollector } from '.'
import { BigNumber } from 'ethers'
import { Op } from 'sequelize'

// Receipts are collected with a delay of 10 minutes after
// the corresponding allocation was closed
const RECEIPT_COLLECT_DELAY = 600_000

interface AllocationReceiptsBatch {
  receipts: AllocationReceipt[]
  timeout: number
}

export interface AllocationReceiptCollectorOptions {
  logger: Logger
  models: QueryFeeModels
  collectEndpoint: URL
}

export class AllocationReceiptCollector implements ReceiptCollector {
  private logger: Logger
  private models: QueryFeeModels
  private collectEndpoint: URL
  private receiptsToCollect!: DHeap<AllocationReceiptsBatch>

  constructor({
    logger,
    models,
    collectEndpoint,
  }: AllocationReceiptCollectorOptions) {
    this.logger = logger.child({ component: 'AllocationReceiptCollector' })
    this.models = models
    this.collectEndpoint = collectEndpoint

    this.startReceiptCollecting()
    this.startVoucherProcessing()
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
        // Collect the receipts for this allocation in 10 minutes
        this.receiptsToCollect.push({
          receipts,
          timeout: now.valueOf() + RECEIPT_COLLECT_DELAY,
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
        this.logger.debug(
          `${this.receiptsToCollect.length} batches of allocation receipts waiting to be collected`,
        )

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
        } else {
          this.logger.debug(
            `No allocation receipt batches are ready to be collected yet`,
          )
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
        { err: indexerError(IndexerErrorCode.IE054) },
      )
    }
  }

  private async submitVoucher(voucher: Voucher): Promise<void> {
    // TODO: Submit the voucher on chain
    // TODO: If that was successful, remove the voucher from the db
    // TODO: If it was unsuccessful, log an error; if the error was that a voucher for the allocation was submitted earlier, remove the voucher from the db
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
