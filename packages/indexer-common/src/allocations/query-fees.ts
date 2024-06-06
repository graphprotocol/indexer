import { Counter, Gauge, Histogram } from 'prom-client'
import axios from 'axios'
import {
  Logger,
  timer,
  BytesWriter,
  toAddress,
  formatGRT,
  Address,
  Metrics,
  Eventual,
  join as joinEventual,
} from '@graphprotocol/common-ts'
import { NetworkContracts as TapContracts } from '@semiotic-labs/tap-contracts-bindings'
import {
  Allocation,
  AllocationReceipt,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  Voucher,
  ReceiptAggregateVoucher,
  ensureAllocationSummary,
  TransactionManager,
  specification as spec,
  SignedRAV,
  allocationSigner,
  tapAllocationIdProof,
  parseGraphQLAllocation,
} from '..'
import { DHeap } from '@thi.ng/heaps'
import { BigNumber, BigNumberish, Contract } from 'ethers'
import { Op } from 'sequelize'
import pReduce from 'p-reduce'
import { TAPSubgraph } from '../tap-subgraph'
import { NetworkSubgraph } from '../network-subgraph'
import gql from 'graphql-tag'
import { QueryInterface } from 'sequelize'

// Receipts are collected with a delay of 20 minutes after
// the corresponding allocation was closed
const RECEIPT_COLLECT_DELAY = 1200_000

interface AllocationReceiptsBatch {
  receipts: AllocationReceipt[]
  timeout: number
}

export interface PartialVoucher {
  allocation: string // (0x-prefixed hex)
  fees: string // (0x-prefixed hex)
  signature: string // (0x-prefixed hex)
  receipt_id_min: string // (0x-prefixed hex)
  receipt_id_max: string // (0x-prefixed hex)
}

interface ReceiptMetrics {
  receiptsToCollect: Gauge<string>
  failedReceipts: Counter<string>
  partialVouchersToExchange: Gauge<string>
  receiptsCollectDuration: Histogram<string>
  vouchers: Counter<string>
  successVoucherRedeems: Counter<string>
  invalidVoucherRedeems: Counter<string>
  failedVoucherRedeems: Counter<string>
  vouchersRedeemDuration: Histogram<string>
  vouchersBatchRedeemSize: Gauge<never>
  voucherCollectedFees: Gauge<string>
  ravRedeemsSuccess: Counter<string>
  ravRedeemsInvalid: Counter<string>
  ravRedeemsFailed: Counter<string>
  ravsRedeemDuration: Histogram<string>
  ravCollectedFees: Gauge<string>
}

export interface AllocationPartialVouchers {
  allocation: string
  partialVouchers: PartialVoucher[]
}

export interface AllocationReceiptCollectorOptions {
  logger: Logger
  metrics: Metrics
  transactionManager: TransactionManager
  allocationExchange: Contract
  tapContracts?: TapContracts
  allocations: Eventual<Allocation[]>
  models: QueryFeeModels
  networkSpecification: spec.NetworkSpecification
  tapSubgraph: TAPSubgraph | undefined
  networkSubgraph: NetworkSubgraph
  queryInterface: QueryInterface
}

export interface ReceiptCollector {
  rememberAllocations(actionID: number, allocationIDs: Address[]): Promise<boolean>
  collectReceipts(actionID: number, allocation: Allocation): Promise<boolean>
}

interface ValidRavs {
  belowThreshold: RavWithAllocation[]
  eligible: RavWithAllocation[]
}

interface RavWithAllocation {
  rav: SignedRAV
  allocation: Allocation
  sender: Address
}

export class AllocationReceiptCollector implements ReceiptCollector {
  declare logger: Logger
  declare metrics: ReceiptMetrics
  declare models: QueryFeeModels
  declare transactionManager: TransactionManager
  declare allocationExchange: Contract
  declare tapContracts?: TapContracts
  declare allocations: Eventual<Allocation[]>
  declare collectEndpoint: URL
  declare partialVoucherEndpoint: URL
  declare voucherEndpoint: URL
  declare receiptsToCollect: DHeap<AllocationReceiptsBatch>
  declare voucherRedemptionThreshold: BigNumber
  declare voucherRedemptionBatchThreshold: BigNumber
  declare voucherRedemptionMaxBatchSize: number
  declare protocolNetwork: string
  declare tapSubgraph: TAPSubgraph | undefined
  declare networkSubgraph: NetworkSubgraph
  declare finalityTime: number
  declare queryInterface: QueryInterface

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Private constructor to prevent direct instantiation
  private constructor() {}

  public static async create({
    logger,
    metrics,
    transactionManager,
    models,
    allocationExchange,
    tapContracts,
    allocations,
    networkSpecification,
    tapSubgraph,
    networkSubgraph,
    queryInterface,
  }: AllocationReceiptCollectorOptions): Promise<AllocationReceiptCollector> {
    const collector = new AllocationReceiptCollector()
    collector.logger = logger.child({ component: 'AllocationReceiptCollector' })
    collector.metrics = registerReceiptMetrics(
      metrics,
      networkSpecification.networkIdentifier,
    )
    collector.transactionManager = transactionManager
    collector.models = models
    collector.allocationExchange = allocationExchange
    collector.tapContracts = tapContracts
    collector.allocations = allocations
    collector.protocolNetwork = networkSpecification.networkIdentifier
    collector.tapSubgraph = tapSubgraph
    collector.networkSubgraph = networkSubgraph
    collector.queryInterface = queryInterface

    // Process Gateway routes
    const gatewayUrls = processGatewayRoutes(networkSpecification.gateway.url)
    collector.collectEndpoint = gatewayUrls.collectReceipts
    collector.voucherEndpoint = gatewayUrls.voucher
    collector.partialVoucherEndpoint = gatewayUrls.partialVoucher

    const {
      voucherRedemptionThreshold,
      voucherRedemptionBatchThreshold,
      voucherRedemptionMaxBatchSize,
      finalityTime,
    } = networkSpecification.indexerOptions
    collector.voucherRedemptionThreshold = voucherRedemptionThreshold
    collector.voucherRedemptionBatchThreshold = voucherRedemptionBatchThreshold
    collector.voucherRedemptionMaxBatchSize = voucherRedemptionMaxBatchSize
    collector.finalityTime = finalityTime

    // Start the AllocationReceiptCollector
    // TODO: Consider calling methods conditionally based on a boolean
    // flag during startup.
    collector.startReceiptCollecting()
    collector.startVoucherProcessing()
    if (collector.tapContracts) {
      collector.logger.info(`RAV processing is initiated`)
      collector.startRAVProcessing()
    }
    await collector.queuePendingReceiptsFromDatabase()
    return collector
  }

  async rememberAllocations(
    actionID: number,
    allocationIDs: Address[],
  ): Promise<boolean> {
    const logger = this.logger.child({
      action: actionID,
      allocations: allocationIDs,
    })

    try {
      logger.info('Remember allocations for collecting receipts later')

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async (transaction) => {
          for (const allocation of allocationIDs) {
            const [summary] = await ensureAllocationSummary(
              this.models,
              allocation,
              transaction,
              this.protocolNetwork,
            )
            await summary.save({ transaction })
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

  async collectReceipts(actionID: number, allocation: Allocation): Promise<boolean> {
    const logger = this.logger.child({
      action: actionID,
      allocation: allocation.id,
      deployment: allocation.subgraphDeployment.id.display,
    })

    try {
      logger.debug(`Queue allocation receipts for collecting`, { actionID, allocation })

      const now = new Date()

      const receipts =
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.models.allocationReceipts.sequelize!.transaction(
          async (transaction) => {
            // Update the allocation summary
            await this.models.allocationSummaries.update(
              { closedAt: now },
              {
                where: {
                  allocation: allocation.id,
                  protocolNetwork: this.protocolNetwork,
                },
                transaction,
              },
            )

            // Return all receipts for the just-closed allocation
            return this.models.allocationReceipts.findAll({
              where: { allocation: allocation.id, protocolNetwork: this.protocolNetwork },
              order: ['id'],
              transaction,
            })
          },
        )

      this.metrics.receiptsToCollect.set(
        { allocation: receipts[0]?.allocation },
        receipts.length,
      )
      if (receipts.length <= 0) {
        logger.debug(`No receipts to collect for allocation`, { actionID, allocation })
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
        actionID,
        allocation,
      })
      return true
    } catch (err) {
      const error = indexerError(IndexerErrorCode.IE053, err)
      this.metrics.failedReceipts.inc({ allocation: allocation.id })
      this.logger.error(`Failed to queue allocation receipts for collecting`, {
        error,
        actionID,
        allocation,
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
      let pendingVouchers: Voucher[] = []
      try {
        pendingVouchers = await this.pendingVouchers() // Ordered by value
      } catch (err) {
        this.logger.warn(`Failed to query pending vouchers`, { err })
        return
      }

      const logger = this.logger.child({})

      const vouchers = await pReduce(
        pendingVouchers,
        async (results, voucher) => {
          if (await this.allocationExchange.allocationsRedeemed(voucher.allocation)) {
            try {
              await this.models.vouchers.destroy({
                where: {
                  allocation: voucher.allocation,
                  protocolNetwork: this.protocolNetwork,
                },
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
        const totalValueGRT = formatGRT(
          vouchers.belowThreshold.reduce(
            (total, voucher) => total.add(BigNumber.from(voucher.amount)),
            BigNumber.from(0),
          ),
        )
        logger.info(`Query vouchers below the redemption threshold`, {
          hint: 'If you would like to redeem vouchers like this, reduce the voucher redemption threshold',
          voucherRedemptionThreshold: formatGRT(this.voucherRedemptionThreshold),
          belowThresholdCount: vouchers.belowThreshold.length,
          totalValueGRT,
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
        this.metrics.vouchersBatchRedeemSize.set(voucherBatch.length)
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
      where: { protocolNetwork: this.protocolNetwork },
      order: [['amount', 'DESC']], // sorted by highest value to maximise the value of the batch
      limit: this.voucherRedemptionMaxBatchSize, // limit the number of vouchers to the max batch size
    })
  }

  startRAVProcessing() {
    const notifyAndMapEligible = (signedRavs: ValidRavs) => {
      if (signedRavs.belowThreshold.length > 0) {
        const logger = this.logger.child({ function: 'startRAVProcessing()' })
        const totalValueGRT = formatGRT(
          signedRavs.belowThreshold.reduce(
            (total, signedRav) =>
              total.add(BigNumber.from(signedRav.rav.rav.valueAggregate)),
            BigNumber.from(0),
          ),
        )
        logger.info(`Query RAVs below the redemption threshold`, {
          hint: 'If you would like to redeem vouchers like this, reduce the voucher redemption threshold',
          voucherRedemptionThreshold: formatGRT(this.voucherRedemptionThreshold),
          belowThresholdCount: signedRavs.belowThreshold.length,
          totalValueGRT,
          allocations: signedRavs.belowThreshold.map(
            (signedRav) => signedRav.rav.rav.allocationId,
          ),
        })
      }
      return signedRavs.eligible
    }

    const pendingRAVs = this.getPendingRAVs()
    const signedRAVs = this.getSignedRAVsEventual(pendingRAVs)
    const eligibleRAVs = signedRAVs
      .map(notifyAndMapEligible)
      .filter((signedRavs) => signedRavs.length > 0)
    eligibleRAVs.pipe(async (ravs) => await this.submitRAVs(ravs))
  }

  private getPendingRAVs(): Eventual<RavWithAllocation[]> {
    return joinEventual({
      timer: timer(30_000),
    }).tryMap(
      async () => {
        const ravs = await this.pendingRAVs()
        if (ravs.length === 0) {
          this.logger.info(`No pending RAVs to process`)
          return []
        }
        const allocations: Allocation[] = await this.getAllocationsfromAllocationIds(ravs)
        this.logger.info(`Retrieved allocations for pending RAVs \n: ${allocations}`)
        return ravs
          .map((rav) => {
            const signedRav = rav.getSignedRAV()
            return {
              rav: signedRav,
              allocation: allocations.find(
                (a) => a.id === toAddress(signedRav.rav.allocationId),
              ),
              sender: rav.senderAddress,
            }
          })
          .filter((rav) => rav.allocation !== undefined) as RavWithAllocation[] // this is safe because we filter out undefined allocations
      },
      { onError: (err) => this.logger.error(`Failed to query pending RAVs`, { err }) },
    )
  }

  private async getAllocationsfromAllocationIds(
    ravs: ReceiptAggregateVoucher[],
  ): Promise<Allocation[]> {
    const allocationIds: string[] = ravs.map((rav) =>
      rav.getSignedRAV().rav.allocationId.toLowerCase(),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnedAllocations: any[] = (
      await this.networkSubgraph.query(
        gql`
          query allocations($allocationIds: [String!]!) {
            allocations(where: { id_in: $allocationIds }) {
              id
              status
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
                queryFeesAmount
                deniedAt
              }
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              createdAtBlockHash
              closedAtEpoch
              closedAtEpoch
              closedAtBlockHash
              poi
              queryFeeRebates
              queryFeesCollected
            }
          }
        `,
        { allocationIds },
      )
    ).data.allocations

    if (returnedAllocations.length == 0) {
      this.logger.error(
        `No allocations returned for ${allocationIds} in network subgraph`,
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return returnedAllocations.map((x) => parseGraphQLAllocation(x, this.protocolNetwork))
  }

  private getSignedRAVsEventual(
    pendingRAVs: Eventual<RavWithAllocation[]>,
  ): Eventual<ValidRavs> {
    return pendingRAVs.tryMap(
      async (pendingRAVs) => {
        return await pReduce(
          pendingRAVs,
          async (results, rav) => {
            if (
              BigNumber.from(rav.rav.rav.valueAggregate).lt(
                this.voucherRedemptionThreshold,
              )
            ) {
              results.belowThreshold.push(rav)
            } else {
              results.eligible.push(rav)
            }
            return results
          },
          { belowThreshold: <RavWithAllocation[]>[], eligible: <RavWithAllocation[]>[] },
        )
      },
      { onError: (err) => this.logger.error(`Failed to reduce to signed RAVs`, { err }) },
    )
  }

  // redeem only if last is true
  // Later can add order and limit
  private async pendingRAVs(): Promise<ReceiptAggregateVoucher[]> {
    const unfinalizedRAVs = await this.models.receiptAggregateVouchers.findAll({
      where: { last: true, final: false },
    })
    // Obtain allocationIds to use as filter in subgraph
    const unfinalizedRavsAllocationIds = unfinalizedRAVs.map((rav) =>
      rav.getSignedRAV().rav.allocationId.toLowerCase(),
    )

    if (unfinalizedRavsAllocationIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tapSubgraphResponse: any
      if (!this.tapSubgraph) {
        tapSubgraphResponse = { data: { transactions: [] } }
      } else {
        tapSubgraphResponse = await this.tapSubgraph!.query(
          gql`
            query transactions($unfinalizedRavsAllocationIds: [String!]!) {
              transactions(
                where: { type: "redeem", allocationID_in: $unfinalizedRavsAllocationIds }
              ) {
                allocationID
              }
            }
          `,
          { unfinalizedRavsAllocationIds },
        )
      }
      const alreadyRedeemedAllocations = tapSubgraphResponse.data.transactions.map(
        (transaction) => transaction.allocationID,
      )

      // Filter unfinalized RAVS fetched from DB, keeping RAVs that have not yet been redeemed on-chain
      const nonRedeemedAllocationIDAddresses = unfinalizedRavsAllocationIds.filter(
        (allocationID) => !alreadyRedeemedAllocations.includes(allocationID),
      )
      // Lowercase and remove '0x' prefix of addresses to match format in TAP DB Tables
      const nonRedeemedAllocationIDsTrunc = nonRedeemedAllocationIDAddresses.map(
        (allocationID) => allocationID.toLowerCase().replace('0x', ''),
      )

      // Mark RAVs as unredeemed in DB if the TAP subgraph couldn't find the redeem Tx.
      // To handle a chain reorg that "unredeemed" the RAVs.
      // WE use sql directly due to a bug in sequelize update:
      // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)

      let query = `
        UPDATE scalar_tap_ravs
        SET redeemed_at = NULL
        WHERE allocation_id IN ('${nonRedeemedAllocationIDsTrunc.join("', '")}')
      `
      await this.queryInterface.sequelize.query(query)

      // // Update those that redeemed_at is older than 60 minutes and mark as final
      query = `
        UPDATE scalar_tap_ravs
        SET final = TRUE
        WHERE last = TRUE AND final = FALSE 
        AND redeemed_at < NOW() - INTERVAL '${this.finalityTime} second'
        AND redeemed_at IS NOT NULL
      `
      await this.queryInterface.sequelize.query(query)

      return await this.models.receiptAggregateVouchers.findAll({
        where: { redeemedAt: null, final: false, last: true },
      })
    }
    return []
  }

  private encodeReceiptBatch(receipts: AllocationReceipt[]): BytesWriter {
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
    return encodedReceipts
  }

  private async obtainReceiptsVoucher(receipts: AllocationReceipt[]): Promise<void> {
    const allocation = receipts[0].allocation
    const logger = this.logger.child({
      allocation,
      function: 'obtainReceiptsVoucher()',
    })
    // Gross underestimated number of receipts the gateway take at once
    const receiptsThreshold = 25_000
    let response
    try {
      logger.info(`Collect receipts for allocation`, {
        receipts: receipts.length,
      })
      const stopTimer = this.metrics.receiptsCollectDuration.startTimer({ allocation })

      // All receipts can fit the gateway, make a single-shot collection
      if (receipts.length <= receiptsThreshold) {
        const encodedReceipts = this.encodeReceiptBatch(receipts)

        // Exchange the receipts for a voucher signed by the counterparty (aka the client)
        response = await axios.post(
          this.collectEndpoint.toString(),
          encodedReceipts.unwrap().buffer,
          { headers: { 'Content-Type': 'application/octet-stream' } },
        )
      } else {
        logger.info(
          `Too many receipts to collect in oneshot, collecting in batches of '${receiptsThreshold} receipts`,
          {
            receipts: receipts.length,
          },
        )
        // Split receipts in batches and collect partial vouchers
        const partialVouchers: Array<PartialVoucher> = []
        for (let i = 0; i < receipts.length; i += receiptsThreshold) {
          const partialReceipts = receipts.slice(
            i,
            Math.min(i + receiptsThreshold, receipts.length),
          )
          const encodedReceipts = this.encodeReceiptBatch(partialReceipts)

          // Exchange the receipts for a partial voucher signed by the counterparty (aka the client)
          response = await axios.post(
            this.partialVoucherEndpoint.toString(),
            encodedReceipts.unwrap().buffer,
            { headers: { 'Content-Type': 'application/octet-stream' } },
          )
          const partialVoucher = response.data as PartialVoucher
          partialVouchers.push(partialVoucher)
        }

        this.metrics.partialVouchersToExchange.set({ allocation }, partialVouchers.length)
        logger.debug(`Partial vouchers to exchange`, {
          partialVouchers: partialVouchers.length,
        })

        const encodedPartialVouchers = encodePartialVouchers(partialVouchers)

        // Exchange the partial vouchers for a voucher
        response = await axios.post(
          this.voucherEndpoint.toString(),
          encodedPartialVouchers,
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      logger.trace('Gateway response', {
        response,
        allocation,
      })

      // Depending of which Gateway endpoint was used, fee information can come in different fields
      const fees = response.data.fees ?? response.data.amount
      if (!fees || !response.data.allocation || !response.data.signature) {
        throw new Error('Failed to parse response from Gateay')
      }

      const voucher = { ...response.data, fees } as {
        allocation: string
        fees: string
        signature: string
      }

      this.metrics.vouchers.inc({
        allocation,
      })
      this.metrics.voucherCollectedFees.set({ allocation }, parseFloat(voucher.fees))

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
            protocolNetwork: this.protocolNetwork,
          },
          transaction,
        })

        logger.debug(`Add voucher received in exchange for receipts to the database`, {
          voucher,
        })

        // Update the query fees tracked against the allocation
        const [summary] = await ensureAllocationSummary(
          this.models,
          toAddress(voucher.allocation),
          transaction,
          this.protocolNetwork,
        )
        summary.collectedFees = BigNumber.from(summary.collectedFees)
          .add(voucher.fees)
          .toString()
        await summary.save({ transaction })

        // Add the voucher to the database
        await this.models.vouchers.findOrCreate({
          where: {
            allocation: toAddress(voucher.allocation),
            protocolNetwork: this.protocolNetwork,
          },
          defaults: {
            allocation: toAddress(voucher.allocation),
            amount: voucher.fees,
            signature: voucher.signature,
            protocolNetwork: this.protocolNetwork,
          },
          transaction,
        })
      })
      stopTimer()
    } catch (err) {
      logger.error(
        `Failed to collect receipts in exchange for an on-chain query fee voucher`,
        { err: indexerError(IndexerErrorCode.IE054, err) },
      )
    }
  }

  private async submitVouchers(vouchers: Voucher[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitVouchers()',
      voucherBatchSize: vouchers.length,
    })

    logger.info(`Redeem query voucher batch on chain`, {
      vouchers,
    })
    const stopTimer = this.metrics.vouchersRedeemDuration.startTimer({
      allocation: vouchers[0].allocation,
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
        this.metrics.invalidVoucherRedeems.inc({ allocation: vouchers[0].allocation })
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
              this.protocolNetwork,
            )
            summary.withdrawnFees = BigNumber.from(summary.withdrawnFees)
              .add(voucher.amount)
              .toString()
            await summary.save({ transaction })
          }
        },
      )
    } catch (err) {
      this.metrics.failedVoucherRedeems.inc({ allocation: vouchers[0].allocation })
      logger.error(`Failed to redeem query fee voucher`, {
        err: indexerError(IndexerErrorCode.IE055, err),
      })
      return
    }
    stopTimer()

    // Remove the now obsolete voucher from the database
    logger.info(`Successfully redeemed query fee voucher, delete local copy`)
    try {
      await this.models.vouchers.destroy({
        where: {
          allocation: vouchers.map((voucher) => voucher.allocation),
          protocolNetwork: this.protocolNetwork,
        },
      })
      this.metrics.successVoucherRedeems.inc({ allocation: vouchers[0].allocation })
      logger.info(`Successfully deleted local voucher copy`)
    } catch (err) {
      logger.warn(`Failed to delete local voucher copy, will try again later`, {
        err,
      })
    }
  }

  private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitRAVs()',
      ravsToSubmit: signedRavs.length,
    })
    if (!this.tapContracts) {
      logger.error(
        `Undefined escrow contracts, but this shouldn't happen as RAV process is only triggered when escrow is provided. \n
        If this error is encountered please report and oepn an issue at https://github.com/graphprotocol/indexer/issues`,
        {
          signedRavs,
        },
      )
      return
    }
    const escrow = this.tapContracts

    logger.info(`Redeem last RAVs on chain individually`, {
      signedRavs,
    })

    // Redeem RAV one-by-one as no plual version available
    for (const { rav: signedRav, allocation, sender } of signedRavs) {
      const { rav } = signedRav
      const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
        allocation: rav.allocationId,
      })
      try {
        const proof = await tapAllocationIdProof(
          allocationSigner(this.transactionManager.wallet, allocation),
          parseInt(this.protocolNetwork.split(':')[1]),
          sender,
          toAddress(rav.allocationId),
          toAddress(escrow.escrow.address),
        )
        this.logger.debug(`Computed allocationIdProof`, {
          allocationId: rav.allocationId,
          proof,
        })
        // Submit the signed RAV on chain
        const txReceipt = await this.transactionManager.executeTransaction(
          () => escrow.escrow.estimateGas.redeem(signedRav, proof),
          (gasLimit) =>
            escrow.escrow.redeem(signedRav, proof, {
              gasLimit,
            }),
          logger.child({ function: 'redeem' }),
        )

        // get tx receipt and post process
        if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
          this.metrics.ravRedeemsInvalid.inc({ allocation: rav.allocationId })
          return
        }
        this.metrics.ravCollectedFees.set(
          { allocation: rav.allocationId },
          parseFloat(rav.valueAggregate.toString()),
        )

        try {
          const addressWithoutPrefix = rav.allocationId.toLowerCase().replace('0x', '')
          // WE use sql directly due to a bug in sequelize update:
          // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
          const query = `
            UPDATE scalar_tap_ravs
            SET redeemed_at = NOW()
            WHERE allocation_id = '${addressWithoutPrefix}'
          `
          await this.queryInterface.sequelize.query(query)

          logger.info(
            `Updated receipt aggregate vouchers table with redeemed_at for allocation ${addressWithoutPrefix}`,
          )
        } catch (err) {
          logger.warn(
            `Failed to update receipt aggregate voucher table with redeemed_at for allocation ${rav.allocationId}`,
            {
              err,
            },
          )
        }
      } catch (err) {
        this.metrics.ravRedeemsFailed.inc({ allocation: rav.allocationId })
        logger.error(`Failed to redeem RAV`, {
          err: indexerError(IndexerErrorCode.IE055, err),
        })
        return
      }
      stopTimer()
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.models.allocationSummaries.sequelize!.transaction(
        async (transaction) => {
          for (const { rav: signedRav } of signedRavs) {
            const { rav } = signedRav
            const [summary] = await ensureAllocationSummary(
              this.models,
              toAddress(rav.allocationId),
              transaction,
              this.protocolNetwork,
            )
            summary.withdrawnFees = BigNumber.from(summary.withdrawnFees)
              .add(rav.valueAggregate)
              .toString()
            await summary.save({ transaction })
          }
        },
      )

      logger.info(`Updated allocation summaries table with withdrawn fees`)
    } catch (err) {
      logger.warn(`Failed to update allocation summaries`, {
        err,
      })
    }

    signedRavs.map((signedRav) =>
      this.metrics.ravRedeemsSuccess.inc({ allocation: signedRav.allocation.id }),
    )
  }

  public async queuePendingReceiptsFromDatabase(): Promise<void> {
    // Obtain all closed allocations
    const closedAllocations = await this.models.allocationSummaries.findAll({
      where: { closedAt: { [Op.not]: null }, protocolNetwork: this.protocolNetwork },
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
        protocolNetwork: this.protocolNetwork,
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

export function encodePartialVouchers(
  partialVouchers: PartialVoucher[],
): AllocationPartialVouchers {
  const uniqueAllocations = new Set(partialVouchers.map((voucher) => voucher.allocation))
    .size
  if (uniqueAllocations !== 1) {
    throw Error(
      `Partial vouchers set must be for a single allocation, '${uniqueAllocations}' unique allocations represented`,
    )
  }

  return {
    allocation: partialVouchers[0].allocation,
    partialVouchers,
  }
}

const registerReceiptMetrics = (metrics: Metrics, networkIdentifier: string) => ({
  receiptsToCollect: new metrics.client.Gauge({
    name: `indexer_agent_receipts_to_collect_${networkIdentifier}`,
    help: 'Individual receipts to collect',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  failedReceipts: new metrics.client.Counter({
    name: `indexer_agent_receipts_failed_${networkIdentifier}`,
    help: 'Failed to queue receipts to collect',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  partialVouchersToExchange: new metrics.client.Gauge({
    name: `indexer_agent_vouchers_to_exchange_${networkIdentifier}`,
    help: 'Individual partial vouchers to exchange',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  receiptsCollectDuration: new metrics.client.Histogram({
    name: `indexer_agent_receipts_exchange_duration_${networkIdentifier}`,
    help: 'Duration of processing and exchanging receipts to voucher',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  vouchers: new metrics.client.Counter({
    name: `indexer_agent_vouchers_${networkIdentifier}`,
    help: 'Individual vouchers to redeem',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  successVoucherRedeems: new metrics.client.Counter({
    name: `indexer_agent_voucher_exchanges_ok_${networkIdentifier}`,
    help: 'Successfully redeemed vouchers',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  invalidVoucherRedeems: new metrics.client.Counter({
    name: `indexer_agent_voucher_exchanges_invalid_${networkIdentifier}`,
    help: 'Invalid vouchers redeems - tx paused or unauthorized',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  failedVoucherRedeems: new metrics.client.Counter({
    name: `indexer_agent_voucher_redeems_failed_${networkIdentifier}`,
    help: 'Failed redeems for vouchers',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  vouchersRedeemDuration: new metrics.client.Histogram({
    name: `indexer_agent_vouchers_redeem_duration_${networkIdentifier}`,
    help: 'Duration of redeeming vouchers',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  vouchersBatchRedeemSize: new metrics.client.Gauge({
    name: `indexer_agent_vouchers_redeem_${networkIdentifier}`,
    help: 'Size of redeeming batched vouchers',
    registers: [metrics.registry],
  }),

  voucherCollectedFees: new metrics.client.Gauge({
    name: `indexer_agent_voucher_collected_fees_${networkIdentifier}`,
    help: 'Amount of query fees collected for a voucher',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  ravRedeemsSuccess: new metrics.client.Counter({
    name: `indexer_agent_rav_exchanges_ok_${networkIdentifier}`,
    help: 'Successfully redeemed ravs',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  ravRedeemsInvalid: new metrics.client.Counter({
    name: `indexer_agent_rav_exchanges_invalid_${networkIdentifier}`,
    help: 'Invalid ravs redeems - tx paused or unauthorized',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  ravRedeemsFailed: new metrics.client.Counter({
    name: `indexer_agent_rav_redeems_failed_${networkIdentifier}`,
    help: 'Failed redeems for ravs',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  ravsRedeemDuration: new metrics.client.Histogram({
    name: `indexer_agent_ravs_redeem_duration_${networkIdentifier}`,
    help: 'Duration of redeeming ravs',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),

  ravCollectedFees: new metrics.client.Gauge({
    name: `indexer_agent_rav_collected_fees_${networkIdentifier}`,
    help: 'Amount of query fees collected for a rav',
    registers: [metrics.registry],
    labelNames: ['allocation'],
  }),
})

interface GatewayRoutes {
  collectReceipts: URL
  voucher: URL
  partialVoucher: URL
}

function processGatewayRoutes(input: string): GatewayRoutes {
  const GATEWAY_ROUTES = {
    collectReceipts: 'collect-receipts',
    voucher: 'voucher',
    partialVoucher: 'partial-voucher',
  }

  // Strip existing information except for protocol and host
  const inputURL = new URL(input)
  const base = `${inputURL.protocol}//${inputURL.host}`

  function route(pathname: string): URL {
    const url = new URL(base)
    url.pathname = pathname
    return url
  }

  return {
    collectReceipts: route(GATEWAY_ROUTES.collectReceipts),
    voucher: route(GATEWAY_ROUTES.voucher),
    partialVoucher: route(GATEWAY_ROUTES.partialVoucher),
  }
}
