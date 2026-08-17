import { Counter, Gauge, Histogram } from 'prom-client'
import {
  Logger,
  toAddress,
  formatGRT,
  Address,
  Metrics,
  Eventual,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  TransactionManager,
  specification as spec,
  SignedRAVv2,
  parseGraphQLAllocation,
  sequentialTimerMap,
  ReceiptAggregateVoucherV2,
  chunk,
} from '..'
import pReduce from 'p-reduce'
import { SubgraphClient, QueryResult } from '../subgraph-client'
import gql from 'graphql-tag'
import { getEscrowAccounts } from './horizon-escrow-accounts'
import {
  GraphHorizonContracts,
  SubgraphServiceContracts,
} from '@graphprotocol/toolshed/deployments'
import { encodeCollectQueryFeesData, PaymentTypes } from '@graphprotocol/toolshed'
import { dataSlice, hexlify, TransactionReceipt } from 'ethers'

// every 15 minutes
const RAV_CHECK_INTERVAL_MS = 900_000

// 1000 here was leading to http 413 request entity too large
const PAGE_SIZE = 200

// How many pending RAVs are reconciled per pass. Rows beyond this stay pending and are
// picked up on later passes once higher value rows settle and leave the set.
const PENDING_RAV_BATCH_SIZE = 1_000

// How many allocation ids go into a single subgraph request. The id filter travels in
// every request body, so it is chunked to keep requests the size they had when the
// batch itself was capped at 100 rows (see the http 413 note above).
const FILTER_CHUNK_SIZE = 100

interface RavMetrics {
  ravRedeemsSuccess: Counter<string>
  ravRedeemsInvalid: Counter<string>
  ravRedeemsFailed: Counter<string>
  ravsRedeemDuration: Histogram<string>
  ravCollectedFees: Gauge<string>
  ravsBelowThreshold: Gauge<string>
  ravsBelowThresholdValueGRT: Gauge<string>
}

interface TapCollectorOptions {
  logger: Logger
  metrics: Metrics
  transactionManager: TransactionManager
  contracts: GraphHorizonContracts & SubgraphServiceContracts
  allocations: Eventual<Allocation[]>
  models: QueryFeeModels
  networkSpecification: spec.NetworkSpecification
  networkSubgraph: SubgraphClient
}

interface ValidRavs {
  belowThreshold: RavWithAllocation[]
  eligible: RavWithAllocation[]
  // Sum of what the below threshold RAVs would still pay out, which for TAPv2 is the
  // aggregate value minus whatever the payer has already collected against it.
  belowThresholdRemaining: bigint
}

export interface RavWithAllocation {
  rav: SignedRAVv2
  allocation: Allocation
  payer: string
}

interface CollectableRav extends RavWithAllocation {
  encodedCallData: string
}

export interface SubgraphResponse {
  paymentsEscrowTransactions: GraphTallyTransaction[]
  _meta: GraphTallyMeta
}

interface GraphTallyMeta {
  block: {
    timestamp: number
    hash: string
  }
}

export interface GraphTallyTransaction {
  id: string
  allocationId: string
  timestamp: number
  payer: {
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

export class GraphTallyCollector {
  declare logger: Logger
  declare metrics: RavMetrics
  declare models: QueryFeeModels
  declare transactionManager: TransactionManager
  declare contracts: GraphHorizonContracts & SubgraphServiceContracts
  declare allocations: Eventual<Allocation[]>
  declare ravRedemptionThreshold: bigint
  declare protocolNetwork: string
  declare networkSubgraph: SubgraphClient
  declare finalityTime: number
  declare indexerAddress: Address
  declare ravCollectionMaxBatchSize: number

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Private constructor to prevent direct instantiation
  private constructor() {}

  public static create({
    logger,
    metrics,
    transactionManager,
    models,
    contracts,
    allocations,
    networkSpecification,
    networkSubgraph,
  }: TapCollectorOptions): GraphTallyCollector {
    const collector = new GraphTallyCollector()
    collector.logger = logger.child({ component: 'GraphTallyCollector' })
    collector.metrics = registerReceiptMetrics(
      metrics,
      networkSpecification.networkIdentifier,
    )
    collector.transactionManager = transactionManager
    collector.models = models
    collector.contracts = contracts
    collector.allocations = allocations
    collector.protocolNetwork = networkSpecification.networkIdentifier
    collector.networkSubgraph = networkSubgraph

    const {
      voucherRedemptionThreshold,
      finalityTime,
      address,
      ravCollectionMaxBatchSize,
    } = networkSpecification.indexerOptions
    collector.ravRedemptionThreshold = voucherRedemptionThreshold
    collector.finalityTime = finalityTime
    collector.indexerAddress = address
    collector.ravCollectionMaxBatchSize = ravCollectionMaxBatchSize

    collector.logger.info(`[TAPv2] RAV processing is initiated`)
    collector.startRAVProcessing()
    return collector
  }

  startRAVProcessing() {
    const notifyAndMapEligible = (signedRavs: ValidRavs) => {
      const logger = this.logger.child({ function: 'startRAVProcessingV2()' })

      // Set every pass, including to 0, so the gauges decay once deferrals clear
      this.metrics.ravsBelowThreshold.set(signedRavs.belowThreshold.length)
      this.metrics.ravsBelowThresholdValueGRT.set(
        parseFloat(formatGRT(signedRavs.belowThresholdRemaining)),
      )

      if (signedRavs.belowThreshold.length > 0) {
        const totalValueGRT = formatGRT(
          signedRavs.belowThreshold.reduce(
            (total, signedRav) => total + BigInt(signedRav.rav.rav.valueAggregate),
            0n,
          ),
        )
        logger.info(`[TAPv2] Query RAVs below the redemption threshold`, {
          hint: 'If you would like to redeem RAVs like this, reduce the voucher redemption threshold',
          ravRedemptionThreshold: formatGRT(this.ravRedemptionThreshold),
          belowThresholdCount: signedRavs.belowThreshold.length,
          totalValueGRT,
          // What is still collectible on those RAVs, once already collected tokens are
          // subtracted. This, not totalValueGRT, is the revenue being left on the table.
          remainingValueGRT: formatGRT(signedRavs.belowThresholdRemaining),
          allocations: signedRavs.belowThreshold.map((signedRav) =>
            collectionIdToAllocationId(signedRav.rav.rav.collectionId),
          ),
        })
      }

      if (signedRavs.eligible.length > 0) {
        const totalValueGRT = formatGRT(
          signedRavs.eligible.reduce(
            (total, signedRav) => total + BigInt(signedRav.rav.rav.valueAggregate),
            0n,
          ),
        )
        logger.info(`[TAPv2] Query RAVs eligible for redemption`, {
          ravRedemptionThreshold: formatGRT(this.ravRedemptionThreshold),
          eligibleCount: signedRavs.eligible.length,
          totalValueGRT,
          allocations: signedRavs.eligible.map((signedRav) =>
            collectionIdToAllocationId(signedRav.rav.rav.collectionId),
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
    return sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: RAV_CHECK_INTERVAL_MS,
      },
      async () => {
        let ravs = await this.pendingRAVs()
        if (ravs.length === 0) {
          this.logger.info(`[TAPv2] No pending RAVs to process`)
          return []
        }
        this.logger.trace(`[TAPv2] Unfiltered pending RAVs to process`, {
          count: ravs.length,
          ravs: ravs.map((r) => ({
            collectionId: r.collectionId,
            payer: r.payer,
            valueAggregate: r.valueAggregate,
            dataService: r.dataService,
          })),
        })
        if (ravs.length > 0) {
          ravs = await this.filterAndUpdateRavs(ravs)
        }
        this.logger.trace(`[TAPv2] Filtered pending RAVs to process`, {
          count: ravs.length,
          ravs: ravs.map((r) => ({
            collectionId: r.collectionId,
            payer: r.payer,
            valueAggregate: r.valueAggregate,
            dataService: r.dataService,
          })),
        })
        const allocations: Allocation[] = await this.getAllocationsfromAllocationIds(ravs)
        this.logger.info(`[TAPv2] Retrieved allocations for pending RAVs`, {
          ravs: ravs.length,
          allocations: allocations.length,
        })
        this.logger.trace(`[TAPv2] RAW DATA`, { ravs, allocations })

        // Create an object for O(1) allocation lookups instead of O(n) Array.find()
        // This optimizes performance from O(n²) to O(n) for large datasets
        const allocationMap: { [key: string]: Allocation } = {}
        for (let i = 0; i < allocations.length; i++) {
          const allocation = allocations[i]
          allocationMap[allocation.id.toLowerCase()] = allocation
        }

        const pendingRAVsToProcess: RavWithAllocation[] = []
        for (let i = 0; i < ravs.length; i++) {
          const rav = ravs[i]
          const signedRav = rav.getSignedRAV()
          const allocationId = toAddress(
            collectionIdToAllocationId(signedRav.rav.collectionId),
          ).toLowerCase()
          const allocation = allocationMap[allocationId] // O(1) lookup
          if (allocation !== undefined) {
            pendingRAVsToProcess.push({
              rav: signedRav,
              allocation: allocation,
              payer: rav.payer,
            })
          }
        }
        this.logger.trace(`[TAPv2] Pending RAVs to process`, {
          pendingRAVsToProcess: pendingRAVsToProcess.length,
        })
        return pendingRAVsToProcess
      },
      {
        onError: (err) =>
          this.logger.info(`[TAPv2] Failed to query pending RAVs`, { err }),
      },
    )
  }

  private async getAllocationsfromAllocationIds(
    ravs: ReceiptAggregateVoucherV2[],
  ): Promise<Allocation[]> {
    // collectionId -> allocationId
    if (ravs.length === 0) {
      return []
    }
    const allocationIds: string[] = ravs.map((rav) =>
      collectionIdToAllocationId(rav.collectionId),
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
        throw `[TAPv2] There was an error while querying Network Subgraph. Errors: ${result.error}`
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
        `[TAPv2] No allocations returned for ${allocationIds} in network subgraph`,
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
        const escrowAccounts = await getEscrowAccounts(
          this.logger,
          this.networkSubgraph,
          this.indexerAddress,
          this.contracts.GraphTallyCollector.target.toString(),
        )
        return await pReduce(
          pendingRAVs,
          async (results, rav) => {
            const tokensCollected = escrowAccounts.getTokensCollectedForReceiver(
              rav.payer,
              rav.rav.rav.collectionId,
            )
            const belowThreshold =
              BigInt(rav.rav.rav.valueAggregate) - tokensCollected <
              this.ravRedemptionThreshold
            this.logger.trace('[TAPv2] RAVs threshold filtering', {
              collectionId: rav.rav.rav.collectionId,
              valueAggregate: formatGRT(rav.rav.rav.valueAggregate),
              tokensCollected: formatGRT(tokensCollected),
              threshold: formatGRT(this.ravRedemptionThreshold),
              belowThreshold,
            })
            if (belowThreshold) {
              results.belowThreshold.push(rav)
              results.belowThresholdRemaining +=
                BigInt(rav.rav.rav.valueAggregate) - tokensCollected
            } else {
              results.eligible.push(rav)
            }
            return results
          },
          {
            belowThreshold: <RavWithAllocation[]>[],
            eligible: <RavWithAllocation[]>[],
            belowThresholdRemaining: 0n,
          },
        )
      },
      {
        onError: (err) =>
          this.logger.info(`[TAPv2] Failed to reduce to signed RAVs`, { err }),
      },
    )
  }

  // redeem only if last is true
  // Highest value first, so that RAVs worth collecting are never crowded out of the
  // batch by dust that sits below the redemption threshold indefinitely.
  private async pendingRAVs(): Promise<ReceiptAggregateVoucherV2[]> {
    const ravs = await this.models.receiptAggregateVouchersV2.findAll({
      where: { last: true, final: false },
      order: [['valueAggregate', 'DESC']],
      limit: PENDING_RAV_BATCH_SIZE,
    })
    if (ravs.length === PENDING_RAV_BATCH_SIZE) {
      this.logger.warn(
        '[TAPv2] Pending RAV batch is full, RAVs below the value cutoff are not reconciled this pass',
        { batchSize: PENDING_RAV_BATCH_SIZE },
      )
    }
    return ravs
  }

  private async filterAndUpdateRavs(
    ravsLastNotFinal: ReceiptAggregateVoucherV2[],
  ): Promise<ReceiptAggregateVoucherV2[]> {
    // look for all transactions for that includes senderaddress[] and allocations[]
    const subgraphResponse = await this.findTransactionsForRavs(ravsLastNotFinal)

    // The collector contract pays out (value_aggregate - tokensCollected) each time, and
    // value_aggregate keeps growing while the allocation earns, so one RAV can be
    // collected many times. It is settled only once tokensCollected covers its value.
    const escrowAccounts = await getEscrowAccounts(
      this.logger,
      this.networkSubgraph,
      this.indexerAddress,
      this.contracts.GraphTallyCollector.target.toString(),
    )

    const settledRavKeys = new Set<string>()
    for (const rav of ravsLastNotFinal) {
      const tokensCollected = escrowAccounts.getTokensCollectedForReceiver(
        hexPrefixed(rav.payer),
        hexPrefixed(rav.collectionId),
      )
      const settled = tokensCollected >= BigInt(rav.valueAggregate)
      if (settled) {
        settledRavKeys.add(ravKey(rav.payer, rav.collectionId))
      }
      this.logger.trace('[TAPv2] RAV settlement check', {
        collectionId: rav.collectionId,
        payer: rav.payer,
        valueAggregate: formatGRT(rav.valueAggregate),
        tokensCollected: formatGRT(tokensCollected),
        settled,
      })
    }

    this.logger.trace('[TAPv2] Cross checking RAVs indexer database with subgraph', {
      subgraphResponse,
      settledCount: settledRavKeys.size,
      ravsLastNotFinal: ravsLastNotFinal.map((rav) => ({
        collectionId: rav.collectionId,
        payer: rav.payer,
        valueAggregate: rav.valueAggregate,
        dataService: rav.dataService,
      })),
    })

    // check for settled ravs in tx list but not marked as redeemed in our database
    await this.markRavsInTransactionsAsRedeemed(
      subgraphResponse,
      ravsLastNotFinal,
      settledRavKeys,
    )

    // Rows carrying a redeemed_at stamp they no longer deserve: either a chain reorg
    // undid the collection transaction, or the RAV has grown since it was collected and
    // is not settled. Clearing redeemed_at puts the row back on the submission list.
    const ravsToClear = ravsLastNotFinal.filter(
      (rav) =>
        !!rav.redeemedAt &&
        (!settledRavKeys.has(ravKey(rav.payer, rav.collectionId)) ||
          !subgraphResponse.paymentsEscrowTransactions.find(
            (tx) =>
              toAddress(rav.payer) === toAddress(tx.payer.id) &&
              toAddress(collectionIdToAllocationId(rav.collectionId)) ===
                toAddress(tx.allocationId),
          )),
    )

    // we use the subgraph timestamp to make decisions
    // block timestamp minus 1 minute (because of blockchain timestamp uncertainty)
    const ONE_MINUTE = 60
    const blockTimestampSecs = subgraphResponse._meta.block.timestamp - ONE_MINUTE

    if (ravsToClear.length > 0) {
      await this.clearRavsRedeemedAt(ravsToClear, blockTimestampSecs)
    }

    // For all settled RAVs that passed finality time, we mark it as final
    await this.markRavsAsFinal(blockTimestampSecs, settledRavKeys)

    return await this.models.receiptAggregateVouchersV2.findAll({
      where: { redeemedAt: null, final: false, last: true },
    })
  }

  public async markRavsInTransactionsAsRedeemed(
    subgraphResponse: SubgraphResponse,
    ravsLastNotFinal: ReceiptAggregateVoucherV2[],
    settledRavKeys: Set<string>,
  ) {
    // The newest transaction per payer and allocation is the one that completed the
    // settlement, so its timestamp is the one that starts the finality countdown.
    const newestTransactionTimestamps = new Map<string, number>()
    for (const tx of subgraphResponse.paymentsEscrowTransactions) {
      const key = `${toAddress(tx.payer.id)}-${toAddress(tx.allocationId)}`
      const newest = newestTransactionTimestamps.get(key)
      if (newest === undefined || tx.timestamp > newest) {
        newestTransactionTimestamps.set(key, tx.timestamp)
      }
    }

    // Only stamp redeemed_at on a RAV that has a collection transaction on chain AND
    // whose full value has been paid out. A partially collected RAV stays unredeemed so
    // the rest of its value still gets collected.
    for (const rav of ravsLastNotFinal) {
      if (rav.redeemedAt || !settledRavKeys.has(ravKey(rav.payer, rav.collectionId))) {
        continue
      }
      const timestamp = newestTransactionTimestamps.get(
        `${toAddress(rav.payer)}-${toAddress(
          collectionIdToAllocationId(rav.collectionId),
        )}`,
      )
      if (timestamp === undefined) {
        continue
      }
      this.logger.trace(
        '[TAPv2] Found transaction for RAV that was fully collected on the blockchain but not marked as redeemed on our database, marking it as redeemed',
        {
          collectionId: rav.collectionId,
          payer: rav.payer,
          timestamp,
        },
      )
      await this.markRavAsRedeemed(rav.collectionId, rav.payer, timestamp)
    }
  }

  public async findTransactionsForRavs(
    ravs: ReceiptAggregateVoucherV2[],
  ): Promise<SubgraphResponse> {
    let meta: GraphTallyMeta | undefined = undefined
    const paymentsEscrowTransactions: GraphTallyTransaction[] = []

    const unfinalizedRavsAllocationIds = [
      ...new Set(
        ravs.map((value) =>
          toAddress(collectionIdToAllocationId(value.collectionId)).toLowerCase(),
        ),
      ),
    ]

    const payerAddresses = [
      ...new Set(ravs.map((value) => toAddress(value.payer).toLowerCase())),
    ]

    // chunk() yields nothing for an empty input, but a query must still run in that
    // case so the caller gets subgraph block metadata back, hence the explicit [[]].
    const allocationIdChunks =
      unfinalizedRavsAllocationIds.length === 0
        ? [[] as string[]]
        : chunk(unfinalizedRavsAllocationIds, FILTER_CHUNK_SIZE)

    for (const allocationIdsChunk of allocationIdChunks) {
      let lastId = ''
      for (;;) {
        // After the first response, every request (across pages and chunks) is pinned
        // to that block, so the whole pass sees one consistent snapshot of the chain.
        let block: { hash: string } | undefined = undefined
        if (meta?.block?.hash) {
          block = {
            hash: meta?.block?.hash,
          }
        }

        const result: QueryResult<SubgraphResponse> =
          await this.networkSubgraph.query<SubgraphResponse>(
            gql`
              query paymentsEscrowTransactions(
                $lastId: String!
                $pageSize: Int!
                $block: Block_height
                $unfinalizedRavsAllocationIds: [String!]!
                $payerAddresses: [String!]!
              ) {
                paymentsEscrowTransactions(
                  first: $pageSize
                  block: $block
                  orderBy: id
                  orderDirection: asc
                  where: {
                    id_gt: $lastId
                    type: "redeem"
                    allocationId_in: $unfinalizedRavsAllocationIds
                    payer_: { id_in: $payerAddresses }
                  }
                ) {
                  id
                  allocationId
                  timestamp
                  payer {
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
              unfinalizedRavsAllocationIds: allocationIdsChunk,
              payerAddresses,
            },
          )

        if (!result.data) {
          throw `[TAPv2] There was an error while querying Network Subgraph. Errors: ${result.error}`
        }
        meta = result.data._meta
        paymentsEscrowTransactions.push(...result.data.paymentsEscrowTransactions)
        if (result.data.paymentsEscrowTransactions.length < PAGE_SIZE) {
          break
        }
        lastId = result.data.paymentsEscrowTransactions.slice(-1)[0].id
      }
    }

    return {
      paymentsEscrowTransactions,
      _meta: meta!,
    }
  }

  // The redeemed_at guard leaves a RAV submitted moments ago alone: the subgraph has not
  // indexed its transaction yet, so we would otherwise clear a stamp that is still valid.
  private async clearRavsRedeemedAt(
    ravsToClear: { collectionId: string; payer: string }[],
    blockTimestampSecs: number,
  ) {
    if (ravsToClear.length == 0) {
      return
    }

    this.logger.trace('[TAPv2] Unsetting redeemed_at for RAVs that are not settled', {
      ravsToClear: ravsToClear.map((rav) => ({
        collectionId: rav.collectionId,
        payer: rav.payer,
      })),
    })

    // We use raw SQL because of a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (open for 7 years, no fix yet)
    const query = `
        UPDATE tap_horizon_ravs
        SET redeemed_at = NULL
        WHERE (collection_id, payer) IN (
          SELECT * FROM unnest($1::char(64)[], $2::char(40)[])
        )
        AND redeemed_at < to_timestamp($3)
      `

    await this.models.receiptAggregateVouchersV2.sequelize?.query(query, {
      bind: [
        ravsToClear.map((rav) => dbCollectionId(rav.collectionId)),
        ravsToClear.map((rav) => dbPayer(rav.payer)),
        blockTimestampSecs,
      ],
    })

    this.logger.warn(
      `[TAPv2] Cleared redeemed_at for RAVs: ${ravsToClear
        .map((rav) => `(${rav.payer},${rav.collectionId})`)
        .join(', ')}`,
    )
  }

  // Only settled RAVs may be finalized: finalizing one that still has value left to
  // collect would hide it from the submission list forever and strand its query fees.
  // We use blockTimestamp instead of NOW() because we must be older than the subgraph.
  private async markRavsAsFinal(blockTimestampSecs: number, settledRavKeys: Set<string>) {
    if (settledRavKeys.size === 0) {
      this.logger.debug('[TAPv2] No settled RAVs to mark as final')
      return
    }

    const settled = [...settledRavKeys].map((key) => {
      const [payer, collectionId] = key.split('-')
      return { payer, collectionId }
    })
    const query = `
        UPDATE tap_horizon_ravs
        SET final = TRUE
        WHERE (collection_id, payer) IN (
          SELECT * FROM unnest($1::char(64)[], $2::char(40)[])
        )
        AND last = TRUE
        AND final = FALSE
        AND redeemed_at IS NOT NULL
        AND redeemed_at < to_timestamp($3)
      `

    const result = await this.models.receiptAggregateVouchersV2.sequelize?.query(query, {
      bind: [
        settled.map((rav) => dbCollectionId(rav.collectionId)),
        settled.map((rav) => dbPayer(rav.payer)),
        blockTimestampSecs - this.finalityTime,
      ],
    })
    this.logger.debug('[TAPv2] Marked RAVs as final', {
      result,
      settledCount: settledRavKeys.size,
      blockTimestampSecs,
      finalityTime: this.finalityTime,
      threshold: blockTimestampSecs - this.finalityTime,
    })
  }

  private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitRAVsV2',
      ravsToSubmit: signedRavs.length,
    })

    logger.info(`[TAPv2] Submit RAVs on chain via batched multicall`, {
      totalRavs: signedRavs.length,
      batchSize: this.ravCollectionMaxBatchSize,
    })

    // 1. Get escrow balances
    const escrowAccounts = await getEscrowAccounts(
      this.logger,
      this.networkSubgraph,
      this.indexerAddress,
      this.contracts.GraphTallyCollector.target.toString(),
    )

    // 2. Pre-filter RAVs by escrow balance
    //    Track reserved balance per payer to prevent race conditions or over-collecting attempts
    const reservedBalancePerPayer = new Map<string, bigint>()
    const escrowApprovedRavs: RavWithAllocation[] = []

    for (const ravWithAllocation of signedRavs) {
      const { rav: signedRav, payer } = ravWithAllocation
      const { rav } = signedRav

      const ravValue = BigInt(rav.valueAggregate.toString())
      const tokensAlreadyCollected = escrowAccounts.getTokensCollectedForReceiver(
        payer,
        rav.collectionId,
      )
      const payerBalance = escrowAccounts.getBalanceForPayer(payer)
      const alreadyReserved = reservedBalancePerPayer.get(payer.toLowerCase()) ?? 0n

      // Skip this RAV if nothing to collect (already fully collected or data inconsistency)
      const tokensToCollect = ravValue - tokensAlreadyCollected // In horizon the RAV value is monotonically increasing
      if (tokensToCollect <= 0n) {
        logger.debug('[TAPv2] Skipping RAV: nothing to collect', {
          collectionId: rav.collectionId,
          ravValue: formatGRT(ravValue),
          tokensAlreadyCollected: formatGRT(tokensAlreadyCollected),
        })
        continue
      }

      // Skip this RAV if the available balance is less than the tokens to collect. Next RAV might be for less tokens so we keep looping.
      const availableBalance = payerBalance - alreadyReserved
      if (availableBalance < tokensToCollect) {
        logger.warn('[TAPv2] Skipping RAV: insufficient escrow balance', {
          collectionId: rav.collectionId,
          payer,
          payerBalance: formatGRT(payerBalance),
          alreadyReserved: formatGRT(alreadyReserved),
          availableBalance: formatGRT(availableBalance),
          tokensToCollect: formatGRT(tokensToCollect),
        })
        continue
      }

      // Reserve this amount for the RAV
      reservedBalancePerPayer.set(payer.toLowerCase(), alreadyReserved + tokensToCollect)
      escrowApprovedRavs.push(ravWithAllocation)
    }

    if (escrowApprovedRavs.length === 0) {
      logger.debug('[TAPv2] No RAVs passed escrow balance check')
      return
    }

    logger.info('[TAPv2] RAVs passed escrow balance check', {
      approved: escrowApprovedRavs.length,
      skipped: signedRavs.length - escrowApprovedRavs.length,
    })

    // 3. Validate on-chain via estimateGas
    //    This catches issues like: already redeemed, invalid signature or any on-chain validation error.
    const validationResults = await Promise.all(
      escrowApprovedRavs.map(async (ravWithAllocation) => {
        const { rav, allocation, payer } = ravWithAllocation
        const result = await this.validateRavForCollection(rav)
        return { rav, allocation, payer, ...result }
      }),
    )

    // 4. Filter to valid RAVs only
    const validRavs: CollectableRav[] = validationResults
      .filter((r) => r.valid && r.encodedCallData)
      .map((r) => ({
        rav: r.rav,
        allocation: r.allocation,
        payer: r.payer,
        encodedCallData: r.encodedCallData!,
      }))

    // Log invalid RAVs
    const invalidRavs = validationResults.filter((r) => !r.valid)
    if (invalidRavs.length > 0) {
      logger.warn('[TAPv2] Some RAVs failed on-chain validation', {
        invalidCount: invalidRavs.length,
        errors: invalidRavs.map((r) => ({
          collectionId: r.rav.rav.collectionId,
          error: r.error,
        })),
      })
      for (const invalid of invalidRavs) {
        this.metrics.ravRedeemsInvalid.inc({
          collection: invalid.rav.rav.collectionId,
        })
      }
    }

    if (validRavs.length === 0) {
      logger.debug('[TAPv2] No RAVs passed on-chain validation')
      return
    }

    logger.info('[TAPv2] Submitting RAVs in batches', {
      totalValid: validRavs.length,
      batchSize: this.ravCollectionMaxBatchSize,
      batchCount: Math.ceil(validRavs.length / this.ravCollectionMaxBatchSize),
    })

    // 5. Chunk into batches of ravCollectionMaxBatchSize
    const batches = chunk(validRavs, this.ravCollectionMaxBatchSize)

    // 6. Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      logger.info(`[TAPv2] Processing batch ${i + 1}/${batches.length}`, {
        batchSize: batch.length,
      })
      await this.redeemRavBatch(logger, batch)
    }
  }

  /**
   * Encodes a collect() call for use in multicall
   */
  private encodeCollectCall(signedRav: SignedRAVv2): string {
    const { rav, signature } = signedRav
    const encodedData = encodeCollectQueryFeesData(rav, hexlify(signature), 0n)

    return this.contracts.SubgraphService.interface.encodeFunctionData('collect', [
      rav.serviceProvider,
      PaymentTypes.QueryFee,
      encodedData,
    ])
  }

  /**
   * Validates a single RAV "on-chain" by calling estimateGas on the collect function.
   * This catches issues like: already redeemed, invalid signature or any on-chain validation error.
   */
  private async validateRavForCollection(
    signedRav: SignedRAVv2,
  ): Promise<{ valid: boolean; encodedCallData?: string; error?: string }> {
    const { rav, signature } = signedRav
    const encodedData = encodeCollectQueryFeesData(rav, hexlify(signature), 0n)

    try {
      await this.contracts.SubgraphService.collect.estimateGas(
        rav.serviceProvider,
        PaymentTypes.QueryFee,
        encodedData,
      )

      // If estimateGas succeeds, encode the full call for multicall
      const encodedCallData = this.encodeCollectCall(signedRav)
      return { valid: true, encodedCallData }
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Parses PaymentCollected events from a transaction receipt.
   * Returns a map of collectionId -> tokens collected.
   */
  private parsePaymentCollectedEvents(
    txReceipt: TransactionReceipt,
  ): Map<string, bigint> {
    const contractInterface = this.contracts.GraphTallyCollector.interface
    const event = contractInterface.getEvent('PaymentCollected')
    const collectorAddress = this.contracts.GraphTallyCollector.target
      .toString()
      .toLowerCase()

    const collectedByCollection = new Map<string, bigint>()

    for (const log of txReceipt.logs) {
      if (
        log.address.toLowerCase() === collectorAddress &&
        log.topics[0] === event.topicHash
      ) {
        const decoded = contractInterface.decodeEventLog(event, log.data, log.topics)
        const collectionId = decoded.collectionId.toString().toLowerCase()
        const tokens = BigInt(decoded.tokens)
        collectedByCollection.set(collectionId, tokens)
      }
    }

    return collectedByCollection
  }

  /**
   * Redeems a batch of RAVs using multicall
   */
  private async redeemRavBatch(logger: Logger, batch: CollectableRav[]): Promise<void> {
    if (batch.length === 0) {
      return
    }

    logger.info('[TAPv2] Redeeming RAV batch via multicall', {
      batchSize: batch.length,
      collectionIds: batch.map((r) => r.rav.rav.collectionId),
    })

    // Build multicall data array
    const callData = batch.map((r) => r.encodedCallData)

    const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
      collection: 'batch',
    })

    try {
      // Execute multicall with estimateGas
      const txReceipt = await this.transactionManager.executeTransaction(
        () => this.contracts.SubgraphService.multicall.estimateGas(callData),
        (gasLimit) => this.contracts.SubgraphService.multicall(callData, { gasLimit }),
        logger.child({ function: 'multicall-collect' }),
      )

      if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
        logger.warn('[TAPv2] Batch redemption returned invalid state', { txReceipt })
        for (const { rav } of batch) {
          this.metrics.ravRedeemsInvalid.inc({ collection: rav.rav.collectionId })
        }
        return
      }

      // Parse all PaymentCollected events from receipt
      const collectedByCollection = this.parsePaymentCollectedEvents(txReceipt)

      // Mark each RAV as redeemed and update metrics
      for (const { rav } of batch) {
        const tokensCollected = collectedByCollection.get(
          rav.rav.collectionId.toLowerCase(),
        )

        if (tokensCollected !== undefined) {
          this.metrics.ravCollectedFees.set(
            { collection: rav.rav.collectionId },
            parseFloat(tokensCollected.toString()),
          )

          try {
            await this.markRavAsRedeemed(rav.rav.collectionId, rav.rav.payer)
            logger.debug('[TAPv2] RAV marked as redeemed', {
              collectionId: rav.rav.collectionId,
              payer: rav.rav.payer,
              tokensCollected: formatGRT(tokensCollected),
            })
          } catch (err) {
            logger.warn('[TAPv2] Failed to mark RAV as redeemed in database', {
              collectionId: rav.rav.collectionId,
              payer: rav.rav.payer,
              err,
            })
          }

          this.metrics.ravRedeemsSuccess.inc({ collection: rav.rav.collectionId })
        } else {
          logger.warn('[TAPv2] PaymentCollected event not found for RAV in batch', {
            collectionId: rav.rav.collectionId,
          })
        }
      }

      logger.info('[TAPv2] Batch redemption completed', {
        batchSize: batch.length,
        eventsFound: collectedByCollection.size,
      })
    } catch (err) {
      logger.error('[TAPv2] Batch redemption failed', {
        batchSize: batch.length,
        err: indexerError(IndexerErrorCode.IE055, err),
      })
      for (const { rav } of batch) {
        this.metrics.ravRedeemsFailed.inc({ collection: rav.rav.collectionId })
      }
    } finally {
      stopTimer()
    }
  }

  public async redeemRav(
    logger: Logger,
    signedRav: SignedRAVv2,
  ): Promise<bigint | undefined> {
    const { rav, signature } = signedRav

    const encodedData = encodeCollectQueryFeesData(rav, hexlify(signature), 0n)

    logger.debug('[TAPv2] Redeeming RAV: sending transaction', {
      rav,
      signature: hexlify(signature),
      encodedData,
    })

    // Submit the signed RAV on chain
    const txReceipt = await this.transactionManager.executeTransaction(
      () =>
        this.contracts.SubgraphService.collect.estimateGas(
          rav.serviceProvider,
          PaymentTypes.QueryFee,
          encodedData,
        ),
      (gasLimit) =>
        this.contracts.SubgraphService.collect(rav.serviceProvider, 0, encodedData, {
          gasLimit,
        }),
      logger.child({ function: 'collect' }),
    )

    // get tx receipt and post process
    if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
      this.metrics.ravRedeemsInvalid.inc({ collection: rav.collectionId })
      return
    }

    logger.debug('[TAPv2] Redeeming RAV: transaction successful', {
      rav,
      txReceipt,
    })

    // Get the actual value collected
    const contractInterface = this.contracts.GraphTallyCollector.interface
    const event = contractInterface.getEvent('PaymentCollected')

    const log = txReceipt.logs.find((log) => log.topics[0] === event.topicHash)
    if (!log) throw new Error('PaymentCollected event not found!')

    const decoded = contractInterface.decodeEventLog(event, log.data, log.topics)
    if (!decoded.tokens) {
      throw new Error(
        `Actual value collected not found for collection ${rav.collectionId}`,
      )
    }
    const actualTokensCollected = BigInt(decoded.tokens)

    this.metrics.ravCollectedFees.set(
      { collection: rav.collectionId },
      parseFloat(actualTokensCollected.toString()),
    )

    try {
      await this.markRavAsRedeemed(rav.collectionId, rav.payer)
      logger.info(
        `[TAPv2] Updated receipt aggregate vouchers v2 table with redeemed_at for collection ${rav.collectionId} and payer ${rav.payer}`,
      )
    } catch (err) {
      logger.warn(
        `[TAPv2] Failed to update receipt aggregate voucher v2 table with redeemed_at for collection ${rav.collectionId} and payer ${rav.payer}`,
        {
          err,
        },
      )
    }

    return actualTokensCollected
  }

  private async markRavAsRedeemed(
    collectionId: string,
    payer: string,
    timestamp?: number,
  ) {
    // We use raw SQL because of a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (open for 7 years, no fix yet)
    const query = `
            UPDATE tap_horizon_ravs
            SET redeemed_at = COALESCE(to_timestamp($3::double precision), NOW())
            WHERE collection_id = $1
            AND payer = $2
          `

    await this.models.receiptAggregateVouchersV2.sequelize?.query(query, {
      bind: [dbCollectionId(collectionId), dbPayer(payer), timestamp ?? null],
    })
  }
}

// The database stores collection ids and addresses lowercased and without the 0x prefix,
// while the subgraph, the contracts and the signed RAV objects all keep the prefix.
function dbCollectionId(collectionId: string): string {
  return collectionId.toString().toLowerCase().replace(/^0x/, '')
}

function dbPayer(payer: string): string {
  return payer.toString().toLowerCase().replace(/^0x/, '')
}

function hexPrefixed(value: string): string {
  const lowercased = value.toString().toLowerCase()
  return lowercased.startsWith('0x') ? lowercased : `0x${lowercased}`
}

// Keyed the way the escrow accounts key their tokensCollected lookup, so a RAV read from
// the database and one read from the subgraph always agree on identity.
function ravKey(payer: string, collectionId: string): string {
  return `${hexPrefixed(payer)}-${hexPrefixed(collectionId)}`
}

const registerReceiptMetrics = (metrics: Metrics, networkIdentifier: string) => ({
  ravRedeemsSuccess: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_exchanges_ok_${networkIdentifier}`,
    help: 'Successfully redeemed RAVs',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravRedeemsInvalid: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_exchanges_invalid_${networkIdentifier}`,
    help: 'Invalid RAVs redeems - tx paused or unauthorized',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravRedeemsFailed: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_redeems_failed_${networkIdentifier}`,
    help: 'Failed redeems for RAVs',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravsRedeemDuration: new metrics.client.Histogram({
    name: `indexer_agent_rav_v2_redeem_duration_${networkIdentifier}`,
    help: 'Duration of redeeming RAVs',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravCollectedFees: new metrics.client.Gauge({
    name: `indexer_agent_rav_v2_collected_fees_${networkIdentifier}`,
    help: 'Amount of query fees collected for a rav v2',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravsBelowThreshold: new metrics.client.Gauge({
    name: `indexer_agent_rav_v2_ravs_below_threshold_${networkIdentifier}`,
    help: 'Number of pending rav v2s deferred because their collectible value is below the redemption threshold',
    registers: [metrics.registry],
  }),

  ravsBelowThresholdValueGRT: new metrics.client.Gauge({
    name: `indexer_agent_rav_v2_ravs_below_threshold_value_grt_${networkIdentifier}`,
    help: 'Total GRT still collectible on pending rav v2s deferred below the redemption threshold',
    registers: [metrics.registry],
  }),
})

function collectionIdToAllocationId(collectionId: string): string {
  return dataSlice(collectionId, 12).toString().toLowerCase()
}
