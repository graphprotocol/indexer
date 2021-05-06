import axios, { AxiosInstance } from 'axios'
import { Logger, timer, BytesWriter } from '@graphprotocol/common-ts'
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
import { BigNumber } from 'ethers';

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
  private collectClient: AxiosInstance
  private receiptsToCollect!: DHeap<AllocationReceiptsBatch>

  constructor({
    logger,
    models,
    collectEndpoint,
  }: AllocationReceiptCollectorOptions) {
    this.logger = logger.child({ component: 'AllocationReceiptCollector' })
    this.models = models
    this.collectClient = axios.create({ url: collectEndpoint.toString() })

    this.startReceiptCollecting()
    this.startVoucherProcessing()
  }

  async collectReceipts(allocation: Allocation): Promise<boolean> {
    try {
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
        this.logger.info(`No receipts to collect for allocation`, {
          allocation: allocation.id,
          deployment: allocation.subgraphDeployment.id.display,
        })
      } else {
        // Collect the receipts for this allocation in 10 minutes
        this.receiptsToCollect.push({
          receipts,
          timeout: now.valueOf() + RECEIPT_COLLECT_DELAY,
        })
      }

      return true
    } catch (err) {
      this.logger.error(`Failed to queue receipts for collecting`, {
        allocation: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
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

          // If the array is empty we cannot know what allocation
          // this group belongs to. Hopefully it doesn't
          // this this far and this is just defensive.
          if (batch.receipts.length === 0) {
            continue;
          }

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

  private async obtainReceiptsVoucher(
    receipts: AllocationReceipt[],
  ): Promise<void> {
    try {
      // Encode the receipt batch to a buffer
      // [allocationId, receipts[]] (in bytes)
      const encodedReceipts = new BytesWriter(20 + (receipts.length * 112));
      encodedReceipts.writeHex(receipts[0].allocation);
      for (let receipt of receipts) {
        // [fee, id, signature]
        const fee = BigNumber.from(receipt.paymentAmount).toHexString();
        const feePadding = 33 - (fee.length / 2);
        encodedReceipts.writeZeroes(feePadding);
        encodedReceipts.writeHex(fee);
        encodedReceipts.writeHex(receipt.id);
        encodedReceipts.writeHex(receipt.signature);
      }

      const clientUrl = 'TODO';

      const response = await this.collectClient.post(clientUrl, encodedReceipts.unwrap().buffer)

      // TODO: Parse the response
      const voucherData: any = {
        /* ... */
      }

      // Replace the receipts with the voucher in one db transaction;
      // should this fail, we'll try to collect these receipts again
      // later
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.vouchers.sequelize!.transaction(async transaction => {
        // Remove all receipts in the batch from the database
        await this.models.allocationReceipts.destroy({
          where: {
            id: receipts.map(receipt => receipt.id),
          },
          transaction,
        })

        // Add the voucher to the database
        await this.models.vouchers.findOrBuild({
          where: { allocation: voucherData.allocation },
          defaults: {
            allocation: voucherData.allocation,
            amount: voucherData.amount,
            signature: voucherData.signature,
          },
          transaction,
        })
      })
    } catch (err) {
      // TODO: Log appropriate indexer error
    }
  }

  private async submitVoucher(voucher: Voucher): Promise<void> {
    // TODO: Submit the voucher on chain
    // TODO: If that was successful, remove the voucher from the db
    // TODO: If it was unsuccessful, log an error; if the error was that a voucher for the allocation was submitted earlier, remove the voucher from the db
  }

  public async queuePendingReceiptsFromDatabase(): Promise<void> {
    // TODO: Obtain all closed allocations and their close times
    //       Put these in a string -> closedAt map

    // TODO: Obtain all receipts for these allocations, group them
    // .     by allocation.
    const uncollectedReceipts = await this.models.allocationReceipts.findAll({
      group: 'allocation',
    })

    // TODO: Group matching receipts into batches, add the right
    //       timestamp for collecting each batch
    const batches: AllocationReceiptsBatch[] = []

    // Queue all batches of uncollected receipts
    for (const batch of batches) {
      this.receiptsToCollect.push(batch)
    }
  }
}
