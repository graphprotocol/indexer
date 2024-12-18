import { BigNumber } from 'ethers'
import {
  indexerError,
  IndexerErrorCode,
  QueryFeeModels,
  AllocationReceiptAttributes,
  ensureAllocationSummary,
  sequentialTimerMap,
} from '@graphprotocol/indexer-common'
import { NativeSignatureVerifier } from '@graphprotocol/indexer-native'
import { Address, Logger, toAddress } from '@graphprotocol/common-ts'
import { Sequelize, Transaction } from 'sequelize'
import pRetry from 'p-retry'
import { ReceiptManager } from '.'

// Takes a valid big-endian hexadecimal string and parses it as a BigNumber
function readNumber(data: string, start: number, end: number): BigNumber {
  return BigNumber.from('0x' + data.slice(start, end))
}

const allocationReceiptValidator = /^[0-9A-Fa-f]{264}$/

async function validateSignature(
  signer: NativeSignatureVerifier,
  receiptData: string,
): Promise<string> {
  const message = receiptData.slice(0, 134)
  const signature = receiptData.slice(134, 264)

  if (!(await signer.verify(message, signature))) {
    throw indexerError(
      IndexerErrorCode.IE031,
      `Invalid signature: expected signer "${signer.address}"`,
    )
  }
  return '0x' + signature
}

export class AllocationReceiptManager implements ReceiptManager {
  private readonly _sequelize: Sequelize
  private readonly _queryFeeModels: QueryFeeModels
  private readonly _cache: Map<string, Readonly<AllocationReceiptAttributes>> = new Map()
  private readonly _flushQueue: string[] = []
  private readonly _allocationReceiptVerifier: NativeSignatureVerifier
  private readonly protocolNetwork: string
  logger: Logger

  constructor(
    sequelize: Sequelize,
    queryFeeModels: QueryFeeModels,
    logger: Logger,
    clientSignerAddress: Address,
    protocolNetwork: string,
  ) {
    this.logger = logger.child({
      component: 'ReceiptManager',
      protocolNetwork,
    })

    this._sequelize = sequelize
    this._queryFeeModels = queryFeeModels
    this._allocationReceiptVerifier = new NativeSignatureVerifier(clientSignerAddress)
    this.protocolNetwork = protocolNetwork

    sequentialTimerMap({ logger: this.logger, milliseconds: 30_000 }, async () => {
      try {
        await this._flushOutstanding()
      } catch (err) {
        logger.error(
          `Failed to sync receipt to the db. If this does not correct itself, revenue may be lost.`,
          { err },
        )
      }
    })
  }

  private _parseAllocationReceipt(receiptData: string): {
    id: string
    allocation: Address
    fees: BigNumber
  } {
    return {
      id: receiptData.slice(104, 134), // 15 bytes
      allocation: toAddress('0x' + receiptData.slice(0, 40)), // 20 bytes
      fees: readNumber(receiptData, 40, 104), // 32 bytes
    }
  }

  // Saves the receipt and returns the allocation for signing
  async add(receiptData: string): Promise<{
    id: string
    allocation: Address
    fees: BigNumber
  }> {
    // Security: Input validation
    if (!allocationReceiptValidator.test(receiptData)) {
      throw indexerError(IndexerErrorCode.IE031, 'Expecting 264 hex characters')
    }

    // TODO: (Security) Additional validations are required to remove trust from
    // the Gateway which are deferred until we can fully remove trust which requires:
    //   * A receiptID based routing solution so that some invariants can be tested
    //     in memory instead of hitting the database for performance (eg: collateral,
    //     and that fees are increasing).
    //   * A ZKP to ensure all receipts can be collected without running out of gas.
    //
    // Validations include:
    //   * The address corresponds to an *unresolved* transfer.
    //   * The unresolved transfer has sufficient collateral to pay for the query.
    //   * Recovering the signature for the binary data in chars 20..56 = the specified address.
    //   * The increase in fee amount from the last known valid state covers the cost of the query
    //   * This receipt ID is not being "forked" by concurrent usage.

    const receipt = this._parseAllocationReceipt(receiptData)
    const signature = await validateSignature(
      this._allocationReceiptVerifier,
      receiptData,
    )

    this._queue({
      id: receipt.id,
      allocation: receipt.allocation,
      fees: receipt.fees.toString(),
      signature,
      protocolNetwork: this.protocolNetwork,
    })

    return receipt
  }

  /// Flushes all receipts that have been registered by this moment in time.
  private async _flushOutstanding(): Promise<void> {
    this.logger.trace('Flushing outsdanding receipts', {
      function: 'flushOutstanding',
      queueLength: this._flushQueue.length,
    })
    let count = this._flushQueue.length

    while (count > 0) {
      count -= 1

      // Swap and pop
      const id = this._flushQueue[count]
      this._flushQueue[count] = this._flushQueue[this._flushQueue.length - 1]
      this._flushQueue.pop()

      // An invariant of this class is that _flushQueue indexes
      // _cache. So, the ! is being used as intended.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const receipt = this._cache.get(id)!
      this._cache.delete(id)

      const logger = this.logger.child({ function: 'flushOutstanding', receipt })

      const transact = async () => {
        // Put this in a transaction because this has a write which is
        // dependent on a read and must be atomic or receipt updates could be dropped.
        await this._sequelize.transaction({}, async (transaction: Transaction) => {
          logger.trace('Begin database transaction to process receipt')
          const [summary, isNewSummary] = await ensureAllocationSummary(
            this._queryFeeModels,
            receipt.allocation,
            transaction,
            this.protocolNetwork,
          )
          logger.trace('Built allocation summary', {
            allocationSummary: summary,
            new: isNewSummary,
          })
          if (isNewSummary) {
            await summary.save({ transaction })
          }

          const [state, isNew] =
            await this._queryFeeModels.allocationReceipts.findOrBuild({
              where: { id: receipt.id },
              defaults: {
                id: receipt.id,
                allocation: receipt.allocation,
                signature: receipt.signature,
                fees: receipt.fees,
                protocolNetwork: this.protocolNetwork,
              },
              transaction,
            })
          logger.trace('Built allocation receipt', {
            allocationReceipt: state,
            new: isNew,
            relatedAllocationSummary: summary,
          })

          // Don't save if we already have a version of the receipt
          // with a higher amount of fees
          if (!isNew) {
            const storedFees = BigNumber.from(state.getDataValue('fees'))
            if (storedFees.gte(receipt.fees)) {
              logger.trace(
                `Stored fees found in allocation receipt are greater than the current receipt, ignoring.`,
                {
                  storedFees,
                  receiptFees: receipt.fees,
                  allocationReceipt: state,
                  relatedAllocationSummary: summary,
                },
              )
              return
            }
          }

          // Make sure the new receipt fee amount and signature are set
          state.set('fees', receipt.fees)
          state.set('signature', receipt.signature)
          logger.trace('Saving allocation')

          // Save the new or updated receipt to the db
          await state.save({ transaction })
          logger.trace('Saved allocation receipt', {
            allocationReceipt: state,
            relatedAllocationSummary: summary,
          })
        })
        logger.trace('End database transaction to process receipt')
      }

      // Save to the db
      try {
        await pRetry(
          async () => {
            try {
              await transact()
            } catch (err) {
              // Only retry if the error is a 40001 error, aka 'could not serialize
              // access due to concurrent update'
              if (err.parent.code !== '40001') {
                throw new pRetry.AbortError(err)
              }
            }
          },
          { retries: 20 } as pRetry.Options,
        )
      } catch (err) {
        // If we fail for whatever reason, keep this data in the cache to flush
        // the next time around.
        //
        // This needs to go back through the normal add method,
        // rather than just inserting back into the queue.
        // The receipt may have advanced while we were trying to flush
        // it and we don't want to overwrite new data with stale data.
        this._queue(receipt)
        throw err
      }
    }
  }

  _queue(receipt: AllocationReceiptAttributes): void {
    // This is collision resistant only because receipts have a globally unique ID.
    const latest = this._cache.get(receipt.id)
    if (latest === undefined || BigNumber.from(latest.fees).lt(receipt.fees)) {
      if (latest === undefined) {
        this._flushQueue.push(receipt.id)
      }
      this._cache.set(receipt.id, receipt)
    }
  }
}
