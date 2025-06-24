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
  ensureAllocationSummary,
  TransactionManager,
  specification as spec,
  SignedRAVv2,
  parseGraphQLAllocation,
  sequentialTimerMap,
  ReceiptAggregateVoucherV2,
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
import { zeroPadValue, dataSlice } from 'ethers'

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
  contracts: GraphHorizonContracts & SubgraphServiceContracts
  allocations: Eventual<Allocation[]>
  models: QueryFeeModels
  networkSpecification: spec.NetworkSpecification
  networkSubgraph: SubgraphClient
}

interface ValidRavs {
  belowThreshold: RavWithAllocation[]
  eligible: RavWithAllocation[]
}

export interface RavWithAllocation {
  rav: SignedRAVv2
  allocation: Allocation
  payer: string
}

export interface SubgraphResponse {
  transactions: GraphTallyTransaction[]
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

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Private constructor to prevent direct instantiation
  private constructor() { }

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

    const { voucherRedemptionThreshold, finalityTime, address } =
      networkSpecification.indexerOptions
    collector.ravRedemptionThreshold = voucherRedemptionThreshold
    collector.finalityTime = finalityTime
    collector.indexerAddress = address

    collector.logger.info(`RAV v2 processing is initiated`)
    collector.startRAVProcessing()
    return collector
  }

  startRAVProcessing() {
    const notifyAndMapEligible = (signedRavs: ValidRavs) => {
      if (signedRavs.belowThreshold.length > 0) {
        const logger = this.logger.child({ function: 'startRAVProcessingV2()' })
        const totalValueGRT = formatGRT(
          signedRavs.belowThreshold.reduce(
            (total, signedRav) => total + BigInt(signedRav.rav.rav.valueAggregate),
            0n,
          ),
        )
        logger.info(`Query RAVs v2 below the redemption threshold`, {
          hint: 'If you would like to redeem RAVs v2 like this, reduce the voucher redemption threshold',
          ravRedemptionThreshold: formatGRT(this.ravRedemptionThreshold),
          belowThresholdCount: signedRavs.belowThreshold.length,
          totalValueGRT,
          allocations: signedRavs.belowThreshold.map(
            (signedRav) => dataSlice(signedRav.rav.rav.collectionId, 12).toString(),
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
          this.logger.info(`No pending RAVs v2 to process`)
          return []
        }
        if (ravs.length > 0) {
          ravs = await this.filterAndUpdateRavs(ravs)
        }
        const allocations: Allocation[] = await this.getAllocationsfromAllocationIds(ravs)
        this.logger.info(`Retrieved allocations for pending RAVs v2`, {
          ravs: ravs.length,
          allocations: allocations.length,
        })
        return ravs
          .map((rav) => {
            const signedRav = rav.getSignedRAV()
            return {
              rav: signedRav,
              allocation: allocations.find(
                (a) => a.id === toAddress(dataSlice(signedRav.rav.collectionId, 12).toString()),
              ),
              payer: rav.payer,
            }
          })
          .filter((rav) => rav.allocation !== undefined) as RavWithAllocation[] // this is safe because we filter out undefined allocations
      },
      { onError: (err) => this.logger.error(`Failed to query pending RAVs v2`, { err }) },
    )
  }

  private async getAllocationsfromAllocationIds(
    ravs: ReceiptAggregateVoucherV2[],
  ): Promise<Allocation[]> {
    const allocationIds: string[] = ravs.map((rav) =>
      dataSlice(rav.collectionId, 12).toString().toLowerCase(),
    )

    let block: { hash: string } | undefined = undefined
    let lastId = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnedAllocations: any[] = []

    for (; ;) {
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
        const escrowAccounts = await getEscrowAccounts(this.networkSubgraph, this.indexerAddress, this.contracts.GraphTallyCollector.target.toString())
        return await pReduce(
          pendingRAVs,
          async (results, rav) => {
            const tokensCollected = escrowAccounts.getTokensCollectedForReceiver(rav.payer, rav.rav.rav.collectionId)
            if ((BigInt(rav.rav.rav.valueAggregate) - tokensCollected) < this.ravRedemptionThreshold) {
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
  private async pendingRAVs(): Promise<ReceiptAggregateVoucherV2[]> {
    return await this.models.receiptAggregateVouchersV2.findAll({
      where: { last: true, final: false },
      limit: 100,
    })
  }

  private async filterAndUpdateRavs(
    ravsLastNotFinal: ReceiptAggregateVoucherV2[],
  ): Promise<ReceiptAggregateVoucherV2[]> {
    // look for all transactions for that includes senderaddress[] and allocations[]
    const subgraphResponse = await this.findTransactionsForRavs(ravsLastNotFinal)

    // check for redeemed ravs in tx list but not marked as redeemed in our database
    this.markRavsInTransactionsAsRedeemed(subgraphResponse, ravsLastNotFinal)

    // Filter unfinalized RAVS fetched from DB, keeping RAVs that have not yet been redeemed on-chain
    const nonRedeemedRavs = ravsLastNotFinal
      // get all ravs that were marked as redeemed in our database
      .filter((rav) => !!rav.redeemedAt)
      // get all ravs that wasn't possible to find the transaction
      .filter(
        (rav) =>
          !subgraphResponse.transactions.find(
            (tx) =>
              toAddress(rav.payer) === toAddress(tx.payer.id) &&
              dataSlice(rav.collectionId, 12) === tx.allocationId,
          ),
      )

    // we use the subgraph timestamp to make decisions
    // block timestamp minus 1 minute (because of blockchain timestamp uncertainty)
    const ONE_MINUTE = 60
    const blockTimestampSecs = subgraphResponse._meta.block.timestamp - ONE_MINUTE

    // Mark RAVs as unredeemed in DB if the TAP subgraph couldn't find the redeem Tx.
    // To handle a chain reorg that "unredeemed" the RAVs.
    if (nonRedeemedRavs.length > 0) {
      await this.revertRavsRedeemed(nonRedeemedRavs, blockTimestampSecs)
    }

    // For all RAVs that passed finality time, we mark it as final
    await this.markRavsAsFinal(blockTimestampSecs)

    return await this.models.receiptAggregateVouchersV2.findAll({
      where: { redeemedAt: null, final: false, last: true },
    })
  }

  public async markRavsInTransactionsAsRedeemed(
    subgraphResponse: SubgraphResponse,
    ravsLastNotFinal: ReceiptAggregateVoucherV2[],
  ) {
    // get a list of transactions for ravs marked as not redeemed in our database
    const redeemedRavsNotOnOurDatabase = subgraphResponse.transactions
      // get only the transactions that exists, this prevents errors marking as redeemed
      // transactions for different senders with the same allocation id
      .filter((tx) => {
        // check if exists in the ravsLastNotFinal list
        return !!ravsLastNotFinal.find(
          (rav) =>
            // rav has the same sender address as tx
            toAddress(rav.payer) === toAddress(tx.payer.id) &&
            // rav has the same allocation id as tx
            dataSlice(rav.collectionId, 12) === tx.allocationId &&
            // rav was marked as not redeemed in the db
            !rav.redeemedAt,
        )
      })

    // for each transaction that is not redeemed on our database
    // but was redeemed on the blockchain, update it to redeemed
    if (redeemedRavsNotOnOurDatabase.length > 0) {
      for (const rav of redeemedRavsNotOnOurDatabase) {
        await this.markRavAsRedeemed(
          zeroPadValue(rav.allocationId, 32),
          rav.payer.id,
          rav.timestamp,
        )
      }
    }
  }

  public async findTransactionsForRavs(
    ravs: ReceiptAggregateVoucherV2[],
  ): Promise<SubgraphResponse> {
    let meta: GraphTallyMeta | undefined = undefined
    let lastId = ''
    const transactions: GraphTallyTransaction[] = []

    const unfinalizedRavsAllocationIds = [
      ...new Set(ravs.map((value) => toAddress(value.collectionId.slice(12)).toLowerCase())),
    ]

    const payerAddresses = [
      ...new Set(ravs.map((value) => toAddress(value.payer).toLowerCase())),
    ]

    for (; ;) {
      let block: { hash: string } | undefined = undefined
      if (meta?.block?.hash) {
        block = {
          hash: meta?.block?.hash,
        }
      }

      const result: QueryResult<SubgraphResponse> =
        await this.networkSubgraph.query<SubgraphResponse>(
          gql`
            query transactions(
              $lastId: String!
              $pageSize: Int!
              $block: Block_height
              $unfinalizedRavsAllocationIds: [String!]!
              $payerAddresses: [String!]!
            ) {
              transactions(
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
            unfinalizedRavsAllocationIds,
            payerAddresses,
          },
        )

      if (!result.data) {
        throw `There was an error while querying Network Subgraph. Errors: ${result.error}`
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
    ravsNotRedeemed: { collectionId: string; payer: string }[],
    blockTimestampSecs: number,
  ) {
    if (ravsNotRedeemed.length == 0) {
      return
    }

    // WE use sql directly due to a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
    const query = `
        UPDATE tap_horizon_ravs
        SET redeemed_at = NULL
        WHERE (collection_id::char(64), payer::char(40)) IN (VALUES ${ravsNotRedeemed
        .map(
          (rav) =>
            `('${rav.collectionId
              .toString()
              .toLowerCase()
              .replace('0x', '')}'::char(64), '${rav.payer
                .toString()
                .toLowerCase()
                .replace('0x', '')}'::char(40))`,
        )
        .join(', ')})
        AND redeemed_at < to_timestamp(${blockTimestampSecs})
      `

    await this.models.receiptAggregateVouchersV2.sequelize?.query(query)

    this.logger.warn(
      `Reverted Redeemed RAVs v2: ${ravsNotRedeemed
        .map((rav) => `(${rav.payer},${rav.collectionId})`)
        .join(', ')}`,
    )
  }

  // we use blockTimestamp instead of NOW() because we must be older than
  // the subgraph timestamp
  private async markRavsAsFinal(blockTimestampSecs: number) {
    const query = `
        UPDATE tap_horizon_ravs
        SET final = TRUE
        WHERE last = TRUE 
        AND final = FALSE 
        AND redeemed_at IS NOT NULL
        AND redeemed_at < to_timestamp(${blockTimestampSecs - this.finalityTime})
      `

    await this.models.receiptAggregateVouchersV2.sequelize?.query(query)
  }

  private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
    const logger = this.logger.child({
      function: 'submitRAVsV2',
      ravsToSubmit: signedRavs.length,
    })

    logger.info(`Submit last RAVs v2 on chain individually`, {
      signedRavs,
    })

    const escrowAccounts = await getEscrowAccounts(this.networkSubgraph, this.indexerAddress, this.contracts.GraphTallyCollector.target.toString())

    // Redeem RAV one-by-one as no plual version available
    const tokensCollectedPerAllocation: { allocationId: string, tokensCollected: bigint }[] = [];

    for (const { rav: signedRav, allocation, payer } of signedRavs) {
      const { rav } = signedRav

      // verify escrow balances
      const ravValue = BigInt(rav.valueAggregate.toString())
      const tokensAlreadyCollected = escrowAccounts.getTokensCollectedForReceiver(payer, rav.collectionId)
      const payerBalance = escrowAccounts.getBalanceForPayer(payer)

      // In horizon the RAV value is monotonically increasing. To calculate the actual outstanding amount we need to subtract the tokens already collected.
      const tokensToCollect = ravValue - tokensAlreadyCollected
      if (payerBalance < tokensToCollect) {
        this.logger.warn(
          'RAV v2 was not sent to the blockchain \
          because its value aggregate is lower than escrow balance.',
          {
            rav,
            payer,
            payerBalance,
          },
        )
        continue
      }

      const stopTimer = this.metrics.ravsRedeemDuration.startTimer({
        collection: rav.collectionId,
      })

      try {
        // subtract from the escrow account
        // THIS IS A MUT OPERATION
        const actualTokensCollected = await this.redeemRav(logger, signedRav)
        if (!actualTokensCollected) {
          throw new Error(`Failed to redeem RAV v2: no tokens collected`)
        }
        tokensCollectedPerAllocation.push({ allocationId: allocation.id, tokensCollected: actualTokensCollected })
        escrowAccounts.updateBalances(payer, rav.collectionId, actualTokensCollected)
      } catch (err) {
        this.metrics.ravRedeemsFailed.inc({ collection: rav.collectionId })
        logger.error(`Failed to redeem RAV v2`, {
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
          for (const { allocationId, tokensCollected } of tokensCollectedPerAllocation) {
            const [summary] = await ensureAllocationSummary(
              this.models,
              toAddress(allocationId.toString()),
              transaction,
              this.protocolNetwork,
            )
            summary.withdrawnFees = (
              BigInt(summary.withdrawnFees) + BigInt(tokensCollected)
            ).toString()
            await summary.save({ transaction })
          }
        },
      )

      logger.info(`Updated allocation summaries table with withdrawn fees for RAV v2`)
    } catch (err) {
      logger.warn(`Failed to update allocation summaries for RAV v2`, {
        err,
      })
    }

    signedRavs.map((signedRav) =>
      this.metrics.ravRedeemsSuccess.inc({ collection: signedRav.rav.rav.collectionId }),
    )
  }

  public async redeemRav(
    logger: Logger,
    signedRav: SignedRAVv2,
  ): Promise<bigint | undefined> {
    const { rav, signature } = signedRav

    const encodedData = encodeCollectQueryFeesData(rav, signature.toString(), 0n)

    // Submit the signed RAV on chain
    const txReceipt = await this.transactionManager.executeTransaction(
      () => this.contracts.SubgraphService.collect.estimateGas(rav.serviceProvider, PaymentTypes.QueryFee, encodedData),
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

    // Get the actual value collected
    const contractInterface = this.contracts.GraphTallyCollector.interface
    const event = contractInterface.getEvent('PaymentCollected')

    const log = txReceipt.logs.find(log => log.topics[0] === event.topicHash);
    if (!log) throw new Error('PaymentCollected event not found!');

    const decoded = contractInterface.decodeEventLog(event, log.data, log.topics);
    if (!decoded.tokens) {
      throw new Error(`Actual value collected not found for collection ${rav.collectionId}`)
    }
    const actualTokensCollected = BigInt(decoded.tokens);

    this.metrics.ravCollectedFees.set(
      { collection: rav.collectionId },
      parseFloat(actualTokensCollected.toString()),
    )

    try {
      await this.markRavAsRedeemed(rav.collectionId, rav.payer)
      logger.info(
        `Updated receipt aggregate vouchers v2 table with redeemed_at for collection ${rav.collectionId} and payer ${rav.payer}`,
      )
    } catch (err) {
      logger.warn(
        `Failed to update receipt aggregate voucher v2 table with redeemed_at for collection ${rav.collectionId} and payer ${rav.payer}`,
        {
          err,
        },
      )
    }

    return actualTokensCollected;
  }

  private async markRavAsRedeemed(
    collectionId: string,
    payer: string,
    timestamp?: number,
  ) {
    // WE use sql directly due to a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
    const query = `
            UPDATE tap_horizon_ravs
            SET redeemed_at = ${timestamp ? `to_timestamp(${timestamp})` : 'NOW()'}
            WHERE collection_id = '${collectionId
        .toString()
        .toLowerCase()
        .replace('0x', '')}'
            AND payer = '${payer
        .toString()
        .toLowerCase()
        .replace('0x', '')}'
          `

    await this.models.receiptAggregateVouchersV2.sequelize?.query(query)
  }
}

const registerReceiptMetrics = (metrics: Metrics, networkIdentifier: string) => ({
  ravRedeemsSuccess: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_exchanges_ok_${networkIdentifier}`,
    help: 'Successfully redeemed ravs v2',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravRedeemsInvalid: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_exchanges_invalid_${networkIdentifier}`,
    help: 'Invalid ravs v2 redeems - tx paused or unauthorized',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravRedeemsFailed: new metrics.client.Counter({
    name: `indexer_agent_rav_v2_redeems_failed_${networkIdentifier}`,
    help: 'Failed redeems for ravs v2',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravsRedeemDuration: new metrics.client.Histogram({
    name: `indexer_agent_rav_v2_redeem_duration_${networkIdentifier}`,
    help: 'Duration of redeeming ravs v2',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),

  ravCollectedFees: new metrics.client.Gauge({
    name: `indexer_agent_rav_v2_collected_fees_${networkIdentifier}`,
    help: 'Amount of query fees collected for a rav v2',
    registers: [metrics.registry],
    labelNames: ['collection'],
  }),
})
