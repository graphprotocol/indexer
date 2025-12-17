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
import pReduce from 'p-reduce'
import { SubgraphClient, QueryResult } from '../subgraph-client'
import gql from 'graphql-tag'
import { getEscrowAccounts } from './escrow-accounts'
import { HDNodeWallet, Wallet } from 'ethers'

// every 15 minutes
const RAV_CHECK_INTERVAL_MS = 900_000

// 1000 here was leading to http 413 request entity too large
const PAGE_SIZE = 200

interface RavMetrics {
  ravRedeemsSuccess: Counter<string>
  ravRedeemsInvalid: Counter<string>
  ravRedeemsFailed: Counter<string>
  ravsRedeemDuration: Histogram<string>
  ravCollectedFees: Gauge<string>
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
  legacyMnemonics: string[]
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
  declare ravRedemptionThreshold: bigint
  declare protocolNetwork: string
  declare tapSubgraph: SubgraphClient
  declare networkSubgraph: SubgraphClient
  declare finalityTime: number
  declare indexerAddress: Address
  declare legacyMnemonics: string[]

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
    legacyMnemonics,
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
    collector.legacyMnemonics = legacyMnemonics

    const { voucherRedemptionThreshold, finalityTime, address } =
      networkSpecification.indexerOptions
    collector.ravRedemptionThreshold = voucherRedemptionThreshold
    collector.finalityTime = finalityTime
    collector.indexerAddress = address

    if (legacyMnemonics.length > 0) {
      collector.logger.info(
        `[TAPv1] RAV processing is initiated with ${legacyMnemonics.length} legacy mnemonic(s) for old allocation support`,
      )
    } else {
      collector.logger.info(`[TAPv1] RAV processing is initiated`)
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
            (total, signedRav) => total + BigInt(signedRav.rav.rav.valueAggregate),
            0n,
          ),
        )
        logger.info(`[TAPv1] Query RAVs below the redemption threshold`, {
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

  private getPendingRAVs(): Eventual<RavWithAllocation[]> {
    return sequentialTimerMap(
      {
        logger: this.logger,
        milliseconds: RAV_CHECK_INTERVAL_MS,
      },
      async () => {
        let ravs = await this.pendingRAVs()
        if (ravs.length === 0) {
          this.logger.info(`[TAPv1] No pending RAVs to process`)
          return []
        }
        this.logger.trace(`[TAPv1] Unfiltered pending RAVs to process`, {
          count: ravs.length,
          ravs: ravs.map((r) => ({
            allocationId: r.allocationId,
            senderAddress: r.senderAddress,
            valueAggregate: r.valueAggregate,
          })),
        })
        if (ravs.length > 0) {
          ravs = await this.filterAndUpdateRavs(ravs)
        }
        this.logger.trace(`[TAPv1] Filtered pending RAVs to process`, {
          count: ravs.length,
          ravs: ravs.map((r) => ({
            allocationId: r.allocationId,
            senderAddress: r.senderAddress,
            valueAggregate: r.valueAggregate,
          })),
        })
        const allocations: Allocation[] = await this.getAllocationsfromAllocationIds(ravs)
        this.logger.info(`[TAPv1] Retrieved allocations for pending RAVs`, {
          ravs: ravs.length,
          allocations: allocations.length,
        })

        // Create an object for O(1) allocation lookups instead of O(n) Array.find()
        // This optimizes performance from O(n²) to O(n) for large datasets
        const allocationMap: { [key: string]: Allocation } = {}
        for (let i = 0; i < allocations.length; i++) {
          const allocation = allocations[i]
          allocationMap[allocation.id.toLowerCase()] = allocation
        }

        const results: RavWithAllocation[] = []
        for (let i = 0; i < ravs.length; i++) {
          const rav = ravs[i]
          const signedRav = rav.getSignedRAV()
          const allocationId = toAddress(
            signedRav.rav.allocationId.toString(),
          ).toLowerCase()
          const allocation = allocationMap[allocationId] // O(1) lookup
          if (allocation !== undefined) {
            results.push({
              rav: signedRav,
              allocation: allocation,
              sender: rav.senderAddress,
            })
          }
        }
        return results
      },
      {
        onError: (err) =>
          this.logger.error(`[TAPv1] Failed to query pending RAVs`, { err }),
      },
    )
  }

  private async getAllocationsfromAllocationIds(
    ravs: ReceiptAggregateVoucher[],
  ): Promise<Allocation[]> {
    const allocationIds: string[] = ravs.map((rav) =>
      rav.getSignedRAV().rav.allocationId.toString().toLowerCase(),
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
        throw `[TAPv1] There was an error while querying Network Subgraph. Errors: ${result.error}`
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
        `[TAPv1] No allocations returned for ${allocationIds} in network subgraph`,
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
            const belowThreshold =
              BigInt(rav.rav.rav.valueAggregate) < this.ravRedemptionThreshold
            this.logger.trace('[TAPv1] RAVs threshold filtering', {
              allocationId: rav.rav.rav.allocationId,
              valueAggregate: formatGRT(rav.rav.rav.valueAggregate),
              threshold: formatGRT(this.ravRedemptionThreshold),
              belowThreshold,
            })
            if (belowThreshold) {
              results.belowThreshold.push(rav)
            } else {
              results.eligible.push(rav)
            }
            return results
          },
          { belowThreshold: <RavWithAllocation[]>[], eligible: <RavWithAllocation[]>[] },
        )
      },
      {
        onError: (err) =>
          this.logger.error(`[TAPv1] Failed to reduce to signed RAVs`, { err }),
      },
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

    this.logger.trace('[TAPv1] Cross checking RAVs indexer database with subgraph', {
      subgraphResponse: tapSubgraphResponse,
      ravsLastNotFinal: ravsLastNotFinal.map((rav) => ({
        allocationId: rav.allocationId,
        senderAddress: rav.senderAddress,
        valueAggregate: rav.valueAggregate,
      })),
    })

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
        this.logger.trace(
          '[TAPv1] Found transaction for RAV that was redeemed on the blockchain but not on our database, marking it as redeemed',
          {
            rav,
          },
        )
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

      this.logger.trace('[TAPv1] Querying Tap Subgraph for RAVs', {
        lastId,
        pageSize: PAGE_SIZE,
        block,
        unfinalizedRavsAllocationIds,
        senderAddresses,
      })
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
        this.logger.error('[TAPv1] There was an error while querying Tap Subgraph', {
          result,
        })
        throw `[TAPv1] There was an error while querying Tap Subgraph. Errors: ${result.error}`
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

    this.logger.trace(
      '[TAPv1] Could not find transaction for RAV that was redeemed on the database, unsetting redeemed_at',
      {
        ravsNotRedeemed,
      },
    )

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
      `[TAPv1] Reverted Redeemed RAVs: ${ravsNotRedeemed
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

    const result = await this.models.receiptAggregateVouchers.sequelize?.query(query)
    this.logger.debug('[TAPv1] Marked RAVs as final', {
      result,
      blockTimestampSecs,
      finalityTime: this.finalityTime,
      threshold: blockTimestampSecs - this.finalityTime,
    })
  }

  private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitRAVs()',
      ravsToSubmit: signedRavs.length,
    })

    logger.info(`[TAPv1] Redeem last RAVs on chain individually`, {
      signedRavs,
    })
    const escrowAccounts = await getEscrowAccounts(this.tapSubgraph, this.indexerAddress)

    // Redeem RAV one-by-one as no plual version available
    for (const { rav: signedRav, allocation, sender } of signedRavs) {
      const { rav } = signedRav

      // verify escrow balances
      const ravValue = BigInt(rav.valueAggregate.toString())
      const senderBalance = escrowAccounts.getBalanceForSender(sender)
      if (senderBalance < ravValue) {
        this.logger.warn(
          '[TAPv1] RAV was not sent to the blockchain \
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
        allocation: rav.allocationId.toString(),
      })
      try {
        await this.redeemRav(logger, allocation, sender, signedRav)
        this.logger.debug('[TAPv1] RAV redeemed successfully', {
          rav,
        })
        // subtract from the escrow account
        // THIS IS A MUT OPERATION
        escrowAccounts.subtractSenderBalance(sender, ravValue)
      } catch (err) {
        this.metrics.ravRedeemsFailed.inc({ allocation: rav.allocationId.toString() })
        logger.error(`[TAPv1] Failed to redeem RAV`, {
          err: indexerError(IndexerErrorCode.IE055, err),
        })
        continue
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
              toAddress(rav.allocationId.toString()),
              transaction,
              this.protocolNetwork,
            )
            summary.withdrawnFees = (
              BigInt(summary.withdrawnFees) + BigInt(rav.valueAggregate)
            ).toString()
            await summary.save({ transaction })
          }
        },
      )

      logger.info(`[TAPv1] Updated allocation summaries table with withdrawn fees`)
    } catch (err) {
      logger.warn(`[TAPv1] Failed to update allocation summaries`, {
        err,
      })
    }

    signedRavs.map((signedRav) =>
      this.metrics.ravRedeemsSuccess.inc({ allocation: signedRav.allocation.id }),
    )
  }

  private getAllocationSigner(allocation: Allocation): { signer: ReturnType<typeof allocationSigner>; isLegacy: boolean } {
    // Try current wallet first
    try {
      return { signer: allocationSigner(this.transactionManager.wallet, allocation), isLegacy: false }
    } catch {
      // Current wallet doesn't match, try legacy mnemonics
    }

    // Try legacy mnemonics
    for (const mnemonic of this.legacyMnemonics) {
      try {
        const legacyWallet = Wallet.fromPhrase(mnemonic) as HDNodeWallet
        return { signer: allocationSigner(legacyWallet, allocation), isLegacy: true }
      } catch {
        // This mnemonic doesn't match either, try next
        continue
      }
    }

    throw new Error(
      `[TAPv1] No mnemonic found that can sign for allocation ${allocation.id}. ` +
      `Tried current operator wallet and ${this.legacyMnemonics.length} legacy mnemonic(s).`,
    )
  }

  public async redeemRav(
    logger: Logger,
    allocation: Allocation,
    sender: Address,
    signedRav: SignedRAV,
  ) {
    const { rav } = signedRav

    const escrow = this.tapContracts

    const { signer, isLegacy } = this.getAllocationSigner(allocation)
    if (isLegacy) {
      logger.info(`[TAPv1] Using legacy mnemonic to sign for allocation ${allocation.id}`)
    }

    const proof = await tapAllocationIdProof(
      signer,
      parseInt(this.protocolNetwork.split(':')[1]),
      sender,
      toAddress(rav.allocationId.toString()),
      toAddress(escrow.escrow.target.toString()),
    )
    this.logger.debug(`[TAPv1] Computed allocationIdProof`, {
      allocationId: rav.allocationId,
      proof,
      isLegacySigner: isLegacy,
    })
    // Submit the signed RAV on chain
    const txReceipt = await this.transactionManager.executeTransaction(
      () => escrow.escrow.redeem.estimateGas(signedRav, proof),
      (gasLimit) =>
        escrow.escrow.redeem(signedRav, proof, {
          gasLimit,
        }),
      logger.child({ function: 'redeem' }),
    )

    // get tx receipt and post process
    if (txReceipt === 'paused' || txReceipt === 'unauthorized') {
      this.metrics.ravRedeemsInvalid.inc({ allocation: rav.allocationId.toString() })
      return
    }

    logger.debug('[TAPv1] Redeeming RAV: transaction successful', {
      rav,
      txReceipt,
    })

    this.metrics.ravCollectedFees.set(
      { allocation: rav.allocationId.toString() },
      parseFloat(rav.valueAggregate.toString()),
    )

    try {
      await this.markRavAsRedeemed(toAddress(rav.allocationId.toString()), sender)
      logger.info(
        `[TAPv1] Updated receipt aggregate vouchers table with redeemed_at for allocation ${rav.allocationId} and sender ${sender}`,
      )
    } catch (err) {
      logger.warn(
        `[TAPv1] Failed to update receipt aggregate voucher table with redeemed_at for allocation ${rav.allocationId}`,
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
})
