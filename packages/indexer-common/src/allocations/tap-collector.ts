import { Counter, Gauge, Histogram } from 'prom-client'
import {
  Logger,
  toAddress,
  formatGRT,
  Address,
  Metrics,
  Eventual,
} from '@graphprotocol/common-ts'
import { NetworkContracts as TapContracts } from '@semiotic-labs/tap-contracts-bindings'
import {
  Allocation,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  ReceiptAggregateVoucher,
  ensureAllocationSummary,
  TransactionManager,
  specification as spec,
  SignedRAV,
  allocationSigner,
  tapAllocationIdProof,
  parseGraphQLAllocation,
  sequentialTimerMap,
} from '..'
import { BigNumber, Contract } from 'ethers'
import pReduce from 'p-reduce'
import { SubgraphClient, QueryResult } from '../subgraph-client'
import gql from 'graphql-tag'
import { getEscrowAccounts } from './escrow-accounts'

// every 15 minutes
const RAV_CHECK_INTERVAL_MS = 900_000

// 1000 here was leading to http 413 request entity too large
const PAGE_SIZE = 200

// Multicall3 contract constants
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
]

interface RavMetrics {
  ravRedeemsSuccess: Counter<string>
  ravRedeemsInvalid: Counter<string>
  ravRedeemsFailed: Counter<string>
  ravsRedeemDuration: Histogram<string>
  ravCollectedFees: Gauge<string>
  ravBatchRedeemSize: Gauge<never>
  ravBatchRedeemSuccess: Counter<never>
  ravBatchRedeemFailed: Counter<never>
}

interface TapCollectorOptions {
  logger: Logger
  metrics: Metrics
  transactionManager: TransactionManager
  tapContracts: TapContracts
  allocations: Eventual<Allocation[]>
  models: QueryFeeModels
  networkSpecification: spec.NetworkSpecification
  tapSubgraph: SubgraphClient
  networkSubgraph: SubgraphClient
}

interface ValidRavs {
  belowThreshold: RavWithAllocation[]
  eligible: RavWithAllocation[]
}

export interface RavWithAllocation {
  rav: SignedRAV
  allocation: Allocation
  sender: Address
}

export interface TapSubgraphResponse {
  transactions: TapTransaction[]
  _meta: TapMeta
}

interface TapMeta {
  block: {
    timestamp: number
    hash: string
  }
}

export interface TapTransaction {
  id: string
  allocationID: string
  timestamp: number
  sender: {
    id: string
  }
}

export interface AllocationsResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allocations: any[]
  meta: {
    block: {
      hash: string
    }
  }
}

export class TapCollector {
  declare logger: Logger
  declare metrics: RavMetrics
  declare models: QueryFeeModels
  declare transactionManager: TransactionManager
  declare tapContracts: TapContracts
  declare allocations: Eventual<Allocation[]>
  declare ravRedemptionThreshold: BigNumber
  declare protocolNetwork: string
  declare tapSubgraph: SubgraphClient
  declare networkSubgraph: SubgraphClient
  declare finalityTime: number
  declare indexerAddress: Address
  declare ravRedemptionBatchSize: number
  declare ravRedemptionBatchThreshold: BigNumber
  declare ravRedemptionMaxBatchSize: number
  declare multicall3: Contract | null

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Private constructor to prevent direct instantiation
  private constructor() {}

  public static create({
    logger,
    metrics,
    transactionManager,
    models,
    tapContracts,
    allocations,
    networkSpecification,
    tapSubgraph,
    networkSubgraph,
  }: TapCollectorOptions): TapCollector {
    const collector = new TapCollector()
    collector.logger = logger.child({ component: 'TapCollector' })
    collector.metrics = registerReceiptMetrics(
      metrics,
      networkSpecification.networkIdentifier,
    )
    collector.transactionManager = transactionManager
    collector.models = models
    collector.tapContracts = tapContracts
    collector.allocations = allocations
    collector.protocolNetwork = networkSpecification.networkIdentifier
    collector.tapSubgraph = tapSubgraph
    collector.networkSubgraph = networkSubgraph

    const {
      voucherRedemptionThreshold,
      finalityTime,
      address,
      ravRedemptionBatchSize,
      ravRedemptionBatchThreshold,
      ravRedemptionMaxBatchSize,
    } = networkSpecification.indexerOptions
    collector.ravRedemptionThreshold = voucherRedemptionThreshold
    collector.finalityTime = finalityTime
    collector.indexerAddress = address
    collector.ravRedemptionBatchSize = ravRedemptionBatchSize
    collector.ravRedemptionBatchThreshold = ravRedemptionBatchThreshold
    collector.ravRedemptionMaxBatchSize = ravRedemptionMaxBatchSize
    collector.multicall3 = null // Will be initialized if needed

    collector.logger.info(`RAV processing is initiated`, {
      batchingEnabled: ravRedemptionBatchSize > 1,
      batchSize: ravRedemptionBatchSize,
      batchThreshold: formatGRT(ravRedemptionBatchThreshold),
      maxBatchSize: ravRedemptionMaxBatchSize,
    })

    // Initialize Multicall3 if batching is enabled
    if (ravRedemptionBatchSize > 1) {
      collector.initializeMulticall3().catch((err) => {
        collector.logger.warn(
          'Failed to initialize Multicall3, falling back to individual redemptions',
          { err },
        )
      })
    }

    collector.startRAVProcessing()
    return collector
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
          hint: 'If you would like to redeem RAVs like this, reduce the voucher redemption threshold',
          ravRedemptionThreshold: formatGRT(this.ravRedemptionThreshold),
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

  private async initializeMulticall3(): Promise<void> {
    try {
      const provider = this.transactionManager.wallet.provider
      if (!provider) {
        throw new Error('No provider available')
      }

      // Check if Multicall3 is deployed at the standard address
      const code = await provider.getCode(MULTICALL3_ADDRESS)
      if (code === '0x' || code === '0x0') {
        this.logger.warn('Multicall3 contract not found at standard address', {
          address: MULTICALL3_ADDRESS,
        })
        return
      }

      // Create Multicall3 contract instance
      this.multicall3 = new Contract(
        MULTICALL3_ADDRESS,
        MULTICALL3_ABI,
        this.transactionManager.wallet,
      )

      this.logger.info('Multicall3 initialized successfully', {
        address: MULTICALL3_ADDRESS,
      })
    } catch (error) {
      this.logger.error('Failed to initialize Multicall3', { error })
      this.multicall3 = null
    }
  }

  private getPendingRAVs(): Eventual<RavWithAllocation[]> {
    return sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: RAV_CHECK_INTERVAL_MS,
      },
      async () => {
        let ravs = await this.pendingRAVs()
        if (ravs.length === 0) {
          this.logger.info(`No pending RAVs to process`)
          return []
        }
        if (ravs.length > 0) {
          ravs = await this.filterAndUpdateRavs(ravs)
        }
        const allocations: Allocation[] = await this.getAllocationsfromAllocationIds(ravs)
        this.logger.info(`Retrieved allocations for pending RAVs`, {
          ravs: ravs.length,
          allocations: allocations.length,
        })
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

    let block: { hash: string } | undefined = undefined
    let lastId = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnedAllocations: any[] = []

    for (;;) {
      const result = await this.networkSubgraph.query<AllocationsResponse>(
        gql`
          query allocations(
            $lastId: String!
            $pageSize: Int!
            $block: Block_height
            $allocationIds: [String!]!
          ) {
            meta: _meta(block: $block) {
              block {
                number
                hash
                timestamp
              }
            }
            allocations(
              first: $pageSize
              block: $block
              orderBy: id
              orderDirection: asc
              where: { id_gt: $lastId, id_in: $allocationIds }
            ) {
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
        { allocationIds, lastId, pageSize: PAGE_SIZE, block },
      )
      if (!result.data) {
        throw `There was an error while querying Network Subgraph. Errors: ${result.error}`
      }

      returnedAllocations.push(...result.data.allocations)
      block = { hash: result.data.meta.block.hash }
      if (result.data.allocations.length < PAGE_SIZE) {
        break
      }
      lastId = result.data.allocations.slice(-1)[0].id
    }

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
              BigNumber.from(rav.rav.rav.valueAggregate).lt(this.ravRedemptionThreshold)
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
    return await this.models.receiptAggregateVouchers.findAll({
      where: { last: true, final: false },
      limit: 100,
    })
  }

  private async filterAndUpdateRavs(
    ravsLastNotFinal: ReceiptAggregateVoucher[],
  ): Promise<ReceiptAggregateVoucher[]> {
    // look for all transactions for that includes senderaddress[] and allocations[]
    const tapSubgraphResponse = await this.findTransactionsForRavs(ravsLastNotFinal)

    // check for redeemed ravs in tx list but not marked as redeemed in our database
    this.markRavsInTransactionsAsRedeemed(tapSubgraphResponse, ravsLastNotFinal)

    // Filter unfinalized RAVS fetched from DB, keeping RAVs that have not yet been redeemed on-chain
    const nonRedeemedRavs = ravsLastNotFinal
      // get all ravs that were marked as redeemed in our database
      .filter((rav) => !!rav.redeemedAt)
      // get all ravs that wasn't possible to find the transaction
      .filter(
        (rav) =>
          !tapSubgraphResponse.transactions.find(
            (tx) =>
              toAddress(rav.senderAddress) === toAddress(tx.sender.id) &&
              toAddress(rav.allocationId) === toAddress(tx.allocationID),
          ),
      )

    // we use the subgraph timestamp to make decisions
    // block timestamp minus 1 minute (because of blockchain timestamp uncertainty)
    const ONE_MINUTE = 60
    const blockTimestampSecs = tapSubgraphResponse._meta.block.timestamp - ONE_MINUTE

    // Mark RAVs as unredeemed in DB if the TAP subgraph couldn't find the redeem Tx.
    // To handle a chain reorg that "unredeemed" the RAVs.
    if (nonRedeemedRavs.length > 0) {
      await this.revertRavsRedeemed(nonRedeemedRavs, blockTimestampSecs)
    }

    // For all RAVs that passed finality time, we mark it as final
    await this.markRavsAsFinal(blockTimestampSecs)

    return await this.models.receiptAggregateVouchers.findAll({
      where: { redeemedAt: null, final: false, last: true },
    })
  }

  public async markRavsInTransactionsAsRedeemed(
    tapSubgraphResponse: TapSubgraphResponse,
    ravsLastNotFinal: ReceiptAggregateVoucher[],
  ) {
    // get a list of transactions for ravs marked as not redeemed in our database
    const redeemedRavsNotOnOurDatabase = tapSubgraphResponse.transactions
      // get only the transactions that exists, this prevents errors marking as redeemed
      // transactions for different senders with the same allocation id
      .filter((tx) => {
        // check if exists in the ravsLastNotFinal list
        return !!ravsLastNotFinal.find(
          (rav) =>
            // rav has the same sender address as tx
            toAddress(rav.senderAddress) === toAddress(tx.sender.id) &&
            // rav has the same allocation id as tx
            toAddress(rav.allocationId) === toAddress(tx.allocationID) &&
            // rav was marked as not redeemed in the db
            !rav.redeemedAt,
        )
      })

    // for each transaction that is not redeemed on our database
    // but was redeemed on the blockchain, update it to redeemed
    if (redeemedRavsNotOnOurDatabase.length > 0) {
      for (const rav of redeemedRavsNotOnOurDatabase) {
        await this.markRavAsRedeemed(
          toAddress(rav.allocationID),
          toAddress(rav.sender.id),
          rav.timestamp,
        )
      }
    }
  }

  public async findTransactionsForRavs(
    ravs: ReceiptAggregateVoucher[],
  ): Promise<TapSubgraphResponse> {
    let meta: TapMeta | undefined = undefined
    let lastId = ''
    const transactions: TapTransaction[] = []

    const unfinalizedRavsAllocationIds = [
      ...new Set(ravs.map((value) => toAddress(value.allocationId).toLowerCase())),
    ]

    const senderAddresses = [
      ...new Set(ravs.map((value) => toAddress(value.senderAddress).toLowerCase())),
    ]

    for (;;) {
      let block: { hash: string } | undefined = undefined
      if (meta?.block?.hash) {
        block = {
          hash: meta?.block?.hash,
        }
      }

      const result: QueryResult<TapSubgraphResponse> =
        await this.tapSubgraph.query<TapSubgraphResponse>(
          gql`
            query transactions(
              $lastId: String!
              $pageSize: Int!
              $block: Block_height
              $unfinalizedRavsAllocationIds: [String!]!
              $senderAddresses: [String!]!
            ) {
              transactions(
                first: $pageSize
                block: $block
                orderBy: id
                orderDirection: asc
                where: {
                  id_gt: $lastId
                  type: "redeem"
                  allocationID_in: $unfinalizedRavsAllocationIds
                  sender_: { id_in: $senderAddresses }
                }
              ) {
                id
                allocationID
                timestamp
                sender {
                  id
                }
              }
              _meta {
                block {
                  hash
                  timestamp
                }
              }
            }
          `,
          {
            lastId,
            pageSize: PAGE_SIZE,
            block,
            unfinalizedRavsAllocationIds,
            senderAddresses,
          },
        )

      if (!result.data) {
        throw `There was an error while querying Tap Subgraph. Errors: ${result.error}`
      }
      meta = result.data._meta
      transactions.push(...result.data.transactions)
      if (result.data.transactions.length < PAGE_SIZE) {
        break
      }
      lastId = result.data.transactions.slice(-1)[0].id
    }

    return {
      transactions,
      _meta: meta!,
    }
  }

  // for every allocation_id of this list that contains the redeemedAt less than the current
  // subgraph timestamp
  private async revertRavsRedeemed(
    ravsNotRedeemed: { allocationId: Address; senderAddress: Address }[],
    blockTimestampSecs: number,
  ) {
    if (ravsNotRedeemed.length == 0) {
      return
    }

    // WE use sql directly due to a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
    const query = `
        UPDATE scalar_tap_ravs
        SET redeemed_at = NULL
        WHERE (allocation_id::char(40), sender_address::char(40)) IN (VALUES ${ravsNotRedeemed
          .map(
            (rav) =>
              `('${rav.allocationId
                .toString()
                .toLowerCase()
                .replace('0x', '')}'::char(40), '${rav.senderAddress
                .toString()
                .toLowerCase()
                .replace('0x', '')}'::char(40))`,
          )
          .join(', ')})
        AND redeemed_at < to_timestamp(${blockTimestampSecs})
      `

    await this.models.receiptAggregateVouchers.sequelize?.query(query)

    this.logger.warn(
      `Reverted Redeemed RAVs: ${ravsNotRedeemed
        .map((rav) => `(${rav.senderAddress},${rav.allocationId})`)
        .join(', ')}`,
    )
  }

  // we use blockTimestamp instead of NOW() because we must be older than
  // the subgraph timestamp
  private async markRavsAsFinal(blockTimestampSecs: number) {
    const query = `
        UPDATE scalar_tap_ravs
        SET final = TRUE
        WHERE last = TRUE 
        AND final = FALSE 
        AND redeemed_at IS NOT NULL
        AND redeemed_at < to_timestamp(${blockTimestampSecs - this.finalityTime})
      `

    await this.models.receiptAggregateVouchers.sequelize?.query(query)
  }

  private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitRAVs()',
      ravsToSubmit: signedRavs.length,
    })

    const escrowAccounts = await getEscrowAccounts(this.tapSubgraph, this.indexerAddress)

    // Check if batching is enabled and Multicall3 is available
    const batchingEnabled = this.ravRedemptionBatchSize > 1 && this.multicall3 !== null

    if (batchingEnabled) {
      logger.info(`Redeeming RAVs in batches`, {
        totalRavs: signedRavs.length,
        batchSize: this.ravRedemptionBatchSize,
        maxBatchSize: this.ravRedemptionMaxBatchSize,
      })
      await this.submitRAVsInBatches(signedRavs, escrowAccounts, logger)
    } else {
      logger.info(`Redeem last RAVs on chain individually`, {
        signedRavs,
      })
      // Redeem RAV one-by-one as no plual version available
      for (const { rav: signedRav, allocation, sender } of signedRavs) {
        const { rav } = signedRav

        // verify escrow balances
        const ravValue = BigInt(rav.valueAggregate.toString())
        const senderBalance = escrowAccounts.getBalanceForSender(sender)
        if (senderBalance < ravValue) {
          this.logger.warn(
            'RAV was not sent to the blockchain \
          because its value aggregate is lower than escrow balance.',
            {
              rav,
              sender,
              senderBalance,
            },
          )
          continue
        }

        const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
          allocation: rav.allocationId,
        })
        try {
          await this.redeemRav(logger, allocation, sender, signedRav)
          // subtract from the escrow account
          // THIS IS A MUT OPERATION
          escrowAccounts.subtractSenderBalance(sender, ravValue)
        } catch (err) {
          this.metrics.ravRedeemsFailed.inc({ allocation: rav.allocationId })
          logger.error(`Failed to redeem RAV`, {
            err: indexerError(IndexerErrorCode.IE055, err),
          })
          continue
        }
        stopTimer()
      }
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

  private async submitRAVsInBatches(
    signedRavs: RavWithAllocation[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    escrowAccounts: any,
    logger: Logger,
  ): Promise<void> {
    // Filter RAVs by escrow balance
    const validRavs = signedRavs.filter(({ rav: signedRav, sender }) => {
      const ravValue = BigInt(signedRav.rav.valueAggregate.toString())
      const senderBalance = escrowAccounts.getBalanceForSender(sender)
      if (senderBalance < ravValue) {
        logger.warn('RAV excluded from batch: value exceeds escrow balance', {
          allocation: signedRav.rav.allocationId,
          sender,
          ravValue: ravValue.toString(),
          senderBalance: senderBalance.toString(),
        })
        return false
      }
      return true
    })

    if (validRavs.length === 0) {
      logger.warn('No valid RAVs to redeem after escrow balance check')
      return
    }

    // Group RAVs into batches
    const batches: RavWithAllocation[][] = []
    let currentBatch: RavWithAllocation[] = []
    let currentBatchValue = BigNumber.from(0)

    for (const rav of validRavs) {
      const ravValue = BigNumber.from(rav.rav.rav.valueAggregate)

      // Check if adding this RAV would exceed batch limits
      const wouldExceedSize = currentBatch.length >= this.ravRedemptionMaxBatchSize

      // Start new batch if limits exceeded
      if (
        currentBatch.length > 0 &&
        (wouldExceedSize ||
          (currentBatch.length >= this.ravRedemptionBatchSize &&
            currentBatchValue.gte(this.ravRedemptionBatchThreshold)))
      ) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchValue = BigNumber.from(0)
      }

      currentBatch.push(rav)
      currentBatchValue = currentBatchValue.add(ravValue)
    }

    // Add final batch if it meets the threshold or contains all remaining RAVs
    if (currentBatch.length > 0) {
      if (
        currentBatchValue.gte(this.ravRedemptionBatchThreshold) ||
        batches.length === 0
      ) {
        batches.push(currentBatch)
      } else {
        // If final batch is below threshold, process individually
        logger.info('Final batch below threshold, processing individually', {
          batchSize: currentBatch.length,
          batchValue: formatGRT(currentBatchValue),
          threshold: formatGRT(this.ravRedemptionBatchThreshold),
        })
        for (const ravData of currentBatch) {
          await this.redeemRavIndividually(ravData, escrowAccounts, logger)
        }
      }
    }

    logger.info('Processing RAV batches', {
      totalBatches: batches.length,
      totalRavs: validRavs.length,
    })

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const batchValue = batch.reduce(
        (sum, rav) => sum.add(rav.rav.rav.valueAggregate),
        BigNumber.from(0),
      )

      logger.info(`Processing batch ${i + 1}/${batches.length}`, {
        batchSize: batch.length,
        batchValue: formatGRT(batchValue),
      })

      try {
        await this.redeemRAVBatch(batch, escrowAccounts, logger)
        this.metrics.ravBatchRedeemSuccess.inc()
      } catch (err) {
        this.metrics.ravBatchRedeemFailed.inc()
        logger.error(
          `Failed to redeem RAV batch, falling back to individual redemption`,
          {
            batch: i + 1,
            error: err,
          },
        )

        // Fall back to individual redemption for failed batch
        for (const ravData of batch) {
          await this.redeemRavIndividually(ravData, escrowAccounts, logger)
        }
      }
    }
  }

  private async redeemRAVBatch(
    batch: RavWithAllocation[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    escrowAccounts: any,
    logger: Logger,
  ): Promise<void> {
    if (!this.multicall3) {
      throw new Error('Multicall3 not initialized')
    }

    const escrow = this.tapContracts.escrow
    const calls: { target: string; allowFailure: boolean; callData: string }[] = []

    // Prepare all calls in the batch
    for (const { rav: signedRav, allocation, sender } of batch) {
      const proof = await tapAllocationIdProof(
        allocationSigner(this.transactionManager.wallet, allocation),
        parseInt(this.protocolNetwork.split(':')[1]),
        sender,
        toAddress(signedRav.rav.allocationId),
        toAddress(escrow.address),
      )

      // Encode the redeem call
      const callData = escrow.interface.encodeFunctionData('redeem', [signedRav, proof])

      calls.push({
        target: escrow.address,
        allowFailure: false, // We want atomic execution
        callData: callData,
      })
    }

    // Execute batch via Multicall3
    this.metrics.ravBatchRedeemSize.set(batch.length)
    const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
      allocation: 'batch',
    })

    try {
      const tx = await this.transactionManager.executeTransaction(
        () => this.multicall3!.estimateGas.aggregate3(calls),
        (gasLimit) => this.multicall3!.aggregate3(calls, { gasLimit }),
        logger.child({ function: 'multicall3.aggregate3' }),
      )

      if (tx === 'paused' || tx === 'unauthorized') {
        this.metrics.ravRedeemsInvalid.inc({ allocation: 'batch' })
        throw new Error(`Transaction ${tx}`)
      }

      // Update escrow balances for successful batch
      for (const { rav: signedRav, sender } of batch) {
        const ravValue = BigInt(signedRav.rav.valueAggregate.toString())
        escrowAccounts.subtractSenderBalance(sender, ravValue)

        // Mark as redeemed
        await this.markRavAsRedeemed(toAddress(signedRav.rav.allocationId), sender)
      }

      // Update metrics
      for (const { allocation } of batch) {
        this.metrics.ravRedeemsSuccess.inc({ allocation: allocation.id })
      }

      logger.info('Successfully redeemed RAV batch', {
        batchSize: batch.length,
        transactionHash: tx.transactionHash,
      })
    } finally {
      stopTimer()
    }
  }

  private async redeemRavIndividually(
    ravData: RavWithAllocation,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    escrowAccounts: any,
    logger: Logger,
  ): Promise<void> {
    const { rav: signedRav, allocation, sender } = ravData
    const { rav } = signedRav
    const ravValue = BigInt(rav.valueAggregate.toString())

    const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
      allocation: rav.allocationId,
    })

    try {
      await this.redeemRav(logger, allocation, sender, signedRav)
      escrowAccounts.subtractSenderBalance(sender, ravValue)
    } catch (err) {
      this.metrics.ravRedeemsFailed.inc({ allocation: rav.allocationId })
      logger.error(`Failed to redeem RAV`, {
        err: indexerError(IndexerErrorCode.IE055, err),
      })
    } finally {
      stopTimer()
    }
  }

  public async redeemRav(
    logger: Logger,
    allocation: Allocation,
    sender: Address,
    signedRav: SignedRAV,
  ) {
    const { rav } = signedRav

    const escrow = this.tapContracts

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
      await this.markRavAsRedeemed(toAddress(rav.allocationId), sender)
      logger.info(
        `Updated receipt aggregate vouchers table with redeemed_at for allocation ${rav.allocationId} and sender ${sender}`,
      )
    } catch (err) {
      logger.warn(
        `Failed to update receipt aggregate voucher table with redeemed_at for allocation ${rav.allocationId}`,
        {
          err,
        },
      )
    }
  }

  private async markRavAsRedeemed(
    allocationId: Address,
    senderAddress: Address,
    timestamp?: number,
  ) {
    // WE use sql directly due to a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
    const query = `
            UPDATE scalar_tap_ravs
            SET redeemed_at = ${timestamp ? `to_timestamp(${timestamp})` : 'NOW()'}
            WHERE allocation_id = '${allocationId
              .toString()
              .toLowerCase()
              .replace('0x', '')}'
            AND sender_address = '${senderAddress
              .toString()
              .toLowerCase()
              .replace('0x', '')}'
          `

    await this.models.receiptAggregateVouchers.sequelize?.query(query)
  }
}

const registerReceiptMetrics = (metrics: Metrics, networkIdentifier: string) => ({
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

  ravBatchRedeemSize: new metrics.client.Gauge({
    name: `indexer_agent_rav_batch_redeem_size_${networkIdentifier}`,
    help: 'Size of RAV batches being redeemed',
    registers: [metrics.registry],
  }),

  ravBatchRedeemSuccess: new metrics.client.Counter({
    name: `indexer_agent_rav_batch_redeem_success_${networkIdentifier}`,
    help: 'Successful batch RAV redemptions',
    registers: [metrics.registry],
  }),

  ravBatchRedeemFailed: new metrics.client.Counter({
    name: `indexer_agent_rav_batch_redeem_failed_${networkIdentifier}`,
    help: 'Failed batch RAV redemptions',
    registers: [metrics.registry],
  }),
})
