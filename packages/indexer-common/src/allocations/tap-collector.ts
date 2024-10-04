import { Counter, Gauge, Histogram } from 'prom-client'
import {
  Logger,
  timer,
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
} from '..'
import { BigNumber } from 'ethers'
import pReduce from 'p-reduce'
import { TAPSubgraph } from '../tap-subgraph'
import { NetworkSubgraph } from '../network-subgraph'
import gql from 'graphql-tag'

const RAV_CHECK_INTERVAL_MS = 30_000

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
  tapSubgraph: TAPSubgraph
  networkSubgraph: NetworkSubgraph
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

export interface TapSubgraphResponse {
  transactions: {
    allocationID: string
    timestamp: number
    sender: {
      id: string
    }
  }[]
  _meta: {
    block: {
      timestamp: number
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
  declare tapSubgraph: TAPSubgraph
  declare networkSubgraph: NetworkSubgraph
  declare finalityTime: number

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Private constructor to prevent direct instantiation
  private constructor() {}

  public static async create({
    logger,
    metrics,
    transactionManager,
    models,
    tapContracts,
    allocations,
    networkSpecification,
    tapSubgraph,
    networkSubgraph,
  }: TapCollectorOptions): Promise<TapCollector> {
    const collector = new TapCollector()
    collector.logger = logger.child({ component: 'AllocationReceiptCollector' })
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

    const { voucherRedemptionThreshold, finalityTime } =
      networkSpecification.indexerOptions
    collector.ravRedemptionThreshold = voucherRedemptionThreshold
    collector.finalityTime = finalityTime

    collector.logger.info(`RAV processing is initiated`)
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

  private getPendingRAVs(): Eventual<RavWithAllocation[]> {
    return joinEventual({
      timer: timer(RAV_CHECK_INTERVAL_MS),
    }).tryMap(
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
        this.logger.info(
          `Retrieved allocations for pending RAVs \n: ${JSON.stringify(allocations)}`,
        )
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
    })
  }

  private async filterAndUpdateRavs(
    ravsLastNotFinal: ReceiptAggregateVoucher[],
  ): Promise<ReceiptAggregateVoucher[]> {
    const tapSubgraphResponse = await this.findTransactionsForRavs(ravsLastNotFinal)

    const redeemedRavsNotOnOurDatabase = tapSubgraphResponse.transactions.filter(
      (tx) =>
        !ravsLastNotFinal.find(
          (rav) =>
            toAddress(rav.senderAddress) === toAddress(tx.sender.id) &&
            toAddress(rav.allocationId) === toAddress(tx.allocationID),
        ),
    )

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

    // Filter unfinalized RAVS fetched from DB, keeping RAVs that have not yet been redeemed on-chain
    const nonRedeemedRavs = ravsLastNotFinal
      .filter((rav) => !!rav.redeemedAt)
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

  public async findTransactionsForRavs(
    ravs: ReceiptAggregateVoucher[],
  ): Promise<TapSubgraphResponse> {
    const response = await this.tapSubgraph!.query<TapSubgraphResponse>(
      gql`
        query transactions(
          $unfinalizedRavsAllocationIds: [String!]!
          $senderAddresses: [String!]!
        ) {
          transactions(
            where: {
              type: "redeem"
              allocationID_in: $unfinalizedRavsAllocationIds
              sender_: { id_in: $senderAddresses }
            }
          ) {
            allocationID
            timestamp
            sender {
              id
            }
          }
          _meta {
            block {
              timestamp
            }
          }
        }
      `,
      {
        unfinalizedRavsAllocationIds: ravs.map((value) =>
          toAddress(value.allocationId).toLowerCase(),
        ),
        senderAddresses: ravs.map((value) =>
          toAddress(value.senderAddress).toLowerCase(),
        ),
      },
    )
    if (!response.data) {
      throw `There was an error while querying Tap Subgraph. Errors: ${response.error}`
    }

    return response.data
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

  private async markRavAsRedeemed(
    allocationId: Address,
    senderAddress: Address,
    timestamp?: number,
  ) {
    // WE use sql directly due to a bug in sequelize update:
    // https://github.com/sequelize/sequelize/issues/7664 (bug been open for 7 years no fix yet or ever)
    const query = `
            UPDATE scalar_tap_ravs
            SET redeemed_at = ${timestamp ? timestamp : 'NOW()'}
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
