import axios from 'axios'
import {
  Logger,
  timer,
  BytesWriter,
  toAddress,
  formatGRT,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationReceipt,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  Voucher,
  ensureAllocationSummary,
  TransactionManager,
} from '@graphprotocol/indexer-common'
import { DHeap } from '@thi.ng/heaps'
import { BigNumber, BigNumberish, Contract } from 'ethers'
import { Op } from 'sequelize'
import pReduce from 'p-reduce'

// Receipts are collected with a delay of 20 minutes after
// the corresponding allocation was closed
const RECEIPT_COLLECT_DELAY = 1200_000

interface AllocationReceiptsBatch {
  receipts: AllocationReceipt[]
  timeout: number
}

export interface AllocationReceiptCollectorOptions {
  logger: Logger
  transactionManager: TransactionManager
  allocationExchange: Contract
  models: QueryFeeModels
  collectEndpoint: URL
  voucherRedemptionThreshold: BigNumber
  voucherRedemptionBatchThreshold: BigNumber
  voucherRedemptionMaxBatchSize: number
  voucherExpiration: number
}

export interface ReceiptCollector {
  rememberAllocations(allocations: Allocation[]): Promise<boolean>
  collectReceipts(allocation: Allocation): Promise<boolean>
}

export class AllocationReceiptCollector implements ReceiptCollector {
  private logger: Logger
  private models: QueryFeeModels
  private transactionManager: TransactionManager
  private allocationExchange: Contract
  private collectEndpoint: URL
  private receiptsToCollect!: DHeap<AllocationReceiptsBatch>
  private voucherRedemptionThreshold: BigNumber
  private voucherRedemptionBatchThreshold: BigNumber
  private voucherRedemptionMaxBatchSize: number
  private voucherExpiration: number

  constructor({
    logger,
    transactionManager,
    models,
    collectEndpoint,
    allocationExchange,
    voucherRedemptionThreshold,
    voucherRedemptionBatchThreshold,
    voucherRedemptionMaxBatchSize,
    voucherExpiration,
  }: AllocationReceiptCollectorOptions) {
    this.logger = logger.child({ component: 'AllocationReceiptCollector' })
    this.transactionManager = transactionManager
    this.models = models
    this.collectEndpoint = collectEndpoint
    this.allocationExchange = allocationExchange
    this.voucherRedemptionThreshold = voucherRedemptionThreshold
    this.voucherRedemptionBatchThreshold = voucherRedemptionBatchThreshold
    this.voucherRedemptionMaxBatchSize = voucherRedemptionMaxBatchSize
    this.voucherExpiration = voucherExpiration

    this.startReceiptCollecting()
    this.startVoucherProcessing()
  }

  async rememberAllocations(allocations: Allocation[]): Promise<boolean> {
    const logger = this.logger.child({
      allocations: allocations.map((allocation) => allocation.id),
    })

    try {
      logger.info('Remember allocations for collecting receipts later')

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async (transaction) => {
          for (const allocation of allocations) {
            const [summary] = await ensureAllocationSummary(
              this.models,
              allocation.id,
              transaction,
            )
            await summary.save()
          }
        },
      )
      return true
    } catch (err) {
      logger.error(`Failed to remember allocations for collecting receipts later`, {
        err: indexerError(IndexerErrorCode.IE056, err),
      })
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

      const receipts =
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.models.allocationReceipts.sequelize!.transaction(
          async (transaction) => {
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
              order: ['id'],
              transaction,
            })
          },
        )

      if (receipts.length <= 0) {
        logger.info(`No receipts to collect for allocation`)
        return false
      }

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
      return true
    } catch (err) {
      const error = indexerError(IndexerErrorCode.IE053, err)
      this.logger.error(`Failed to queue allocation receipts for collecting`, {
        error,
      })
      throw error
    }
  }

  private startReceiptCollecting() {
    this.receiptsToCollect = new DHeap<AllocationReceiptsBatch>(null, {
      compare: (t1, t2) => t1.timeout - t2.timeout,
    })

    const hasReceiptsReadyForCollecting = () => {
      const batch = this.receiptsToCollect.peek()
      return batch && batch.timeout <= Date.now()
    }

    // Check if there's another batch of receipts to collect every 10s
    timer(10_000).pipe(async () => {
      while (hasReceiptsReadyForCollecting()) {
        // Remove the batch from the processing queue
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const batch = this.receiptsToCollect.pop()!

        // If the array is empty we cannot know what allocation this group
        // belongs to. Should this assertion ever fail, then there is a
        // programmer error where empty batches are pushed to the
        // `receiptsToCollect` queue.
        console.assert(batch.receipts.length > 0)

        // Collect the receipts now
        await this.obtainReceiptsVoucher(batch.receipts)
      }
    })
  }

  private startVoucherProcessing() {
    timer(30_000).pipe(async () => {
      const pendingVouchers = await this.pendingVouchers() // Ordered by value

      const logger = this.logger.child({})

      const vouchers = await pReduce(
        pendingVouchers,
        async (results, voucher) => {
          if (await this.allocationExchange.allocationsRedeemed(voucher.allocation)) {
            try {
              await this.models.vouchers.destroy({
                where: { allocation: voucher.allocation },
              })
              logger.warn(
                `Query fee voucher for allocation already redeemed, deleted local voucher copy`,
                { allocation: voucher.allocation },
              )
            } catch (err) {
              logger.warn(`Failed to delete local vouchers copy, will try again later`, {
                err,
                allocation: voucher.allocation,
              })
            }
            return results
          }
          if (BigNumber.from(voucher.amount).lt(this.voucherRedemptionThreshold)) {
            results.belowThreshold.push(voucher)
          } else {
            results.eligible.push(voucher)
          }
          return results
        },
        { belowThreshold: <Voucher[]>[], eligible: <Voucher[]>[] },
      )

      if (vouchers.belowThreshold.length > 0) {
        logger.info(`Query vouchers below the redemption threshold`, {
          hint: 'If you would like to redeem vouchers like this, reduce the voucher redemption threshold',
          voucherRedemptionThreshold: formatGRT(this.voucherRedemptionThreshold),
          belowThresholdCount: vouchers.belowThreshold.length,
          totalValueGRT: formatGRT(
            vouchers.belowThreshold.reduce(
              (total, voucher) => total.add(BigNumber.from(voucher.amount)),
              BigNumber.from(0),
            ),
          ),
          allocations: vouchers.belowThreshold.map((voucher) => voucher.allocation),
        })
      }

      // If there are no eligible vouchers then bail
      if (vouchers.eligible.length === 0) return

      // Already ordered by value
      const voucherBatch = vouchers.eligible.slice(0, this.voucherRedemptionMaxBatchSize),
        batchValueGRT = voucherBatch.reduce(
          (total, voucher) => total.add(BigNumber.from(voucher.amount)),
          BigNumber.from(0),
        )

      if (batchValueGRT.gt(this.voucherRedemptionBatchThreshold)) {
        logger.info(`Query voucher batch is ready for redemption`, {
          batchSize: voucherBatch.length,
          voucherRedemptionMaxBatchSize: this.voucherRedemptionMaxBatchSize,
          voucherRedemptionBatchThreshold: formatGRT(
            this.voucherRedemptionBatchThreshold,
          ),
          batchValueGRT: formatGRT(batchValueGRT),
        })
        await this.submitVouchers(voucherBatch)
      } else {
        logger.info(`Query voucher batch value too low for redemption`, {
          batchSize: voucherBatch.length,
          voucherRedemptionMaxBatchSize: this.voucherRedemptionMaxBatchSize,
          voucherRedemptionBatchThreshold: formatGRT(
            this.voucherRedemptionBatchThreshold,
          ),
          batchValueGRT: formatGRT(batchValueGRT),
        })
      }
    })
  }

  private async pendingVouchers(): Promise<Voucher[]> {
    return this.models.vouchers.findAll({
      order: [['amount', 'DESC']], // sorted by highest value to maximise the value of the batch
      limit: this.voucherRedemptionMaxBatchSize, // limit the number of vouchers to the max batch size
    })
  }

  private async obtainReceiptsVoucher(receipts: AllocationReceipt[]): Promise<void> {
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
        const fee = BigNumber.from(receipt.fees).toHexString()
        const feePadding = 33 - fee.length / 2
        encodedReceipts.writeZeroes(feePadding)
        encodedReceipts.writeHex(fee)
        encodedReceipts.writeHex(receipt.id)
        encodedReceipts.writeHex(receipt.signature)
      }

      // Exchange the receipts for a voucher signed by the counterparty (aka the client)
      const response = await axios.post(
        this.collectEndpoint.toString(),
        encodedReceipts.unwrap().buffer,
        { headers: { 'Content-Type': 'application/octet-stream' } },
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
      await this.models.vouchers.sequelize!.transaction(async (transaction) => {
        logger.debug(`Removing collected receipts from the database`, {
          receipts: receipts.length,
        })

        // Remove all receipts in the batch from the database
        await this.models.allocationReceipts.destroy({
          where: {
            id: receipts.map((receipt) => receipt.id),
          },
          transaction,
        })

        logger.debug(`Add voucher received in exchange for receipts to the database`)

        // Update the query fees tracked against the allocation
        const [summary] = await ensureAllocationSummary(
          this.models,
          toAddress(voucher.allocation),
          transaction,
        )
        summary.collectedFees = BigNumber.from(summary.collectedFees)
          .add(voucher.amount)
          .toString()
        await summary.save({ transaction })

        // Add the voucher to the database
        await this.models.vouchers.findOrCreate({
          where: { allocation: toAddress(voucher.allocation) },
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

  private async submitVouchers(vouchers: Voucher[]): Promise<void> {
    const logger = this.logger.child({
      voucherBatchSize: vouchers.length,
    })

    logger.info(`Redeem query voucher batch on chain`, {
      allocations: vouchers.map((voucher) => voucher.allocation),
    })

    const hexPrefix = (bytes: string): string =>
      bytes.startsWith('0x') ? bytes : `0x${bytes}`

    const onchainVouchers = vouchers.map((voucher) => {
      return {
        allocationID: hexPrefix(voucher.allocation),
        amount: voucher.amount,
        signature: hexPrefix(voucher.signature),
      }
    })

    try {
      // Submit the voucher on chain
      const txReceipt = await this.transactionManager.executeTransaction(
        () => this.allocationExchange.estimateGas.redeemMany(onchainVouchers),
        async (gasLimit: BigNumberish) =>
          this.allocationExchange.redeemMany(onchainVouchers, {
            gasLimit,
          }),
        logger.child({ action: 'redeemMany' }),
      )

      if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async (transaction) => {
          for (const voucher of vouchers) {
            const [summary] = await ensureAllocationSummary(
              this.models,
              toAddress(voucher.allocation),
              transaction,
            )
            summary.withdrawnFees = BigNumber.from(summary.withdrawnFees)
              .add(voucher.amount)
              .toString()
            await summary.save()
          }
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
        where: { allocation: vouchers.map((voucher) => voucher.allocation) },
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
      closedAllocations.map((summary) => [
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
        allocation: closedAllocations.map((summary) => summary.allocation),
      },
      order: ['id'],
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
