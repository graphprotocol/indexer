import { BigNumber, utils } from 'ethers'
import {
  indexerError,
  IndexerErrorCode,
  Receipt,
  ReceiptModel,
  ReceiptTransfer,
} from '@graphprotocol/indexer-common'
import { Address, Logger, timer, toAddress } from '@graphprotocol/common-ts'
import { Sequelize, Transaction } from 'sequelize'
import { RestServerNodeService } from '@connext/vector-utils'

// Reverses endianness of a valid hexadecimal string without the leading 0x
// Eg: "a1b2c3" => "c3b2a1".
// This is here because solidity uses little-endian, your machine very
// likely uses little-endian (and for good reason), Rust libraries that we
// use support little-endian, but ethers BigNumber uses big-endian and
// doesn't even bother to document the fact. The format choice we have
// is to optimize for Rust -> solidity and cut out JS.
function reverseEndianness(value: string) {
  let result = ''
  for (let i = value.length; i > 1; i -= 2) {
    result += value.slice(i - 2, i)
  }
  return result
}

// Takes a valid little-endian hexadecimal string and parses it as a BigNumber
function readNumber(data: string, start: number, end: number): BigNumber {
  return BigNumber.from('0x' + reverseEndianness(data.slice(start, end)))
}

function readBinary(data: string, start: number, end: number): Uint8Array {
  return utils.arrayify('0x' + data.slice(start, end))
}

const paymentValidator = /^[0-9A-Fa-f]{266}$/

// Cache which avoids concurrently getting the same thing more than once.
class AsyncCache<K, V> {
  private readonly _attempts: Map<K, Promise<V>> = new Map()
  private readonly _fn: (k: K) => Promise<V>

  constructor(fn: (k: K) => Promise<V>) {
    this._fn = fn
  }

  get(k: K): Promise<V> {
    const cached = this._attempts.get(k)
    if (cached) {
      return cached
    }

    // This shares concurrent attempts, but still retries on failure.
    const attempt = (async () => {
      try {
        return await this._fn(k)
      } catch (e) {
        // By removing the cached attempt we ensure this is retried
        this._attempts.delete(k)
        throw e
      }
    })()
    this._attempts.set(k, attempt)
    return attempt
  }
}

async function getTransfer(
  node: RestServerNodeService,
  channelAddress: string,
  routingId: string,
  vectorTransferDefinition: Address,
): Promise<ReceiptTransfer> {
  // Get the transfer
  const result = await node.getTransferByRoutingId({ channelAddress, routingId })

  if (result.isError) {
    throw result.getError()
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const transfer = result.getValue()!

  // Security: Ensure that the verifying contract of the transfer
  // is the expected one. Otherwise we may be approving data which does
  // not unlock expected funds.
  if (toAddress(transfer.transferDefinition) !== vectorTransferDefinition) {
    throw new Error(
      `Transfer "${transfer.transferId}" has unsupported transfer definition "${transfer.transferDefinition}"`,
    )
  }

  return {
    signer: toAddress(transfer.transferState.signer),
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    allocation: toAddress(transfer.meta!.allocation),
  }
}

function validateSignature(transfer: ReceiptTransfer, receiptData: string): string {
  const signedData = readBinary(receiptData, 64, 136)
  const signature = '0x' + receiptData.slice(136, 266)
  const address = utils.recoverAddress(utils.keccak256(signedData), signature)
  if (toAddress(address) !== transfer.signer) {
    throw indexerError(
      IndexerErrorCode.IE031,
      `Invalid signature: recovered signer "${address}" but expected signer "${transfer.signer}"`,
    )
  }
  return signature
}

export class ReceiptManager {
  private readonly _sequelize: Sequelize
  private readonly _receiptModel: ReceiptModel
  private readonly _cache: Map<string, Readonly<Receipt>> = new Map()
  private readonly _flushQueue: string[] = []
  private readonly _transferCache: AsyncCache<string, ReceiptTransfer>

  private constructor(
    sequelize: Sequelize,
    model: ReceiptModel,
    logger: Logger,
    node: RestServerNodeService,
    channelAddress: string,
    vectorTransferDefinition: Address,
  ) {
    this._sequelize = sequelize
    this._receiptModel = model
    this._transferCache = new AsyncCache((routingId: string) =>
      getTransfer(node, channelAddress, routingId, vectorTransferDefinition),
    )

    timer(30_000).pipe(async () => {
      try {
        while (await this._flushOne());
      } catch (err) {
        logger.error(
          `Failed to sync payment to the db. If this does not correct itself, revenue may be lost.`,
          { err },
        )
      }
    })
  }

  public static async create(
    sequelize: Sequelize,
    model: ReceiptModel,
    logger: Logger,
    chainId: number,
    vectorNodeUrl: string,
    vectorRouterIdentifier: string,
    vectorTransferDefinition: Address,
  ): Promise<ReceiptManager> {
    logger = logger.child({ component: 'ReceiptManager' })

    // Connect to Vector node
    const node = await RestServerNodeService.connect(vectorNodeUrl, logger, undefined, 0)

    // Ensure there is a channel set up with the router
    logger.info(`Establish state channel with router`, {
      publicIdentifier: node.publicIdentifier,
      counterpartyIdentifier: vectorRouterIdentifier,
      chainId,
    })

    let channelAddress: string
    try {
      const result = await node.getStateChannelByParticipants({
        publicIdentifier: node.publicIdentifier,
        counterparty: vectorRouterIdentifier,
        chainId,
      })
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      channelAddress = result.getValue()!.channelAddress
    } catch (err) {
      try {
        const result = await node.setup({
          counterpartyIdentifier: vectorRouterIdentifier,
          chainId,
          timeout: '86400',
        })

        if (result.isError) {
          throw result.getError()
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        channelAddress = result.getValue()!.channelAddress
      } catch (err) {
        logger.error(`Failed to set up state channel with router`, {
          publicIdentifier: node.publicIdentifier,
          counterpartyIdentifier: vectorRouterIdentifier,
          chainId,
        })
        throw err
      }
    }

    logger.info(`Successfully established state channel with router`, {
      publicIdentifier: node.publicIdentifier,
      counterpartyIdentifier: vectorRouterIdentifier,
      chainId,
      channelAddress,
    })

    return new ReceiptManager(
      sequelize,
      model,
      logger,
      node,
      channelAddress,
      vectorTransferDefinition,
    )
  }

  // Saves the payment and returns the allocation for signing
  async add(receiptData: string): Promise<string> {
    // Security: Input validation
    if (!paymentValidator.test(receiptData)) {
      throw indexerError(IndexerErrorCode.IE031, 'Expecting 266 hex characters')
    }

    const vectorTransferId = '0x' + receiptData.slice(0, 64)

    // This should always work for valid transfers (aside from eg: network failures)
    // The Gateway initiates a transfer, but won't use it until there is a double-signed
    // commitment. That means our Vector node should know about it.
    const transfer = await this._transferCache.get(vectorTransferId)

    const signature = validateSignature(transfer, receiptData)

    const paymentAmount = readNumber(receiptData, 64, 128)
    const id = readNumber(receiptData, 128, 136).toNumber()

    const receipt: Receipt = {
      paymentAmount,
      id,
      signature,
      signer: transfer.signer,
    }
    this._queue(receipt)
    return transfer.allocation

    // TODO: (Security) Additional validations are required to remove trust from
    // the Gateway which are deferred until we can fully remove trust which requires:
    //   * A receiptID based routing solution so that some invariants can be tested
    //     in memory instead of hitting the database for performance (eg: collateral,
    //     and that payments are increasing).
    //   * A ZKP to ensure all receipts can be collected without running out of gas.
    //
    // Validations include:
    //   * The address corresponds to an *unresolved* transfer.
    //   * The unresolved transfer has sufficient collateral to pay for the query.
    //   * Recovering the signature for the binary data in chars 20..56 = the specified address.
    //   * The increase in payment amount from the last known valid state covers the cost of the query
    //   * This receipt ID is not being "forked" by concurrent usage.
  }

  private async _flushOne(): Promise<boolean> {
    if (!this._flushQueue.length) {
      return false
    }

    const index = Math.floor(Math.random() * this._flushQueue.length)
    const swap = this._flushQueue[index]
    this._flushQueue[index] = this._flushQueue[this._flushQueue.length - 1]
    this._flushQueue[this._flushQueue.length - 1] = swap
    // Classic swap-n-pop. The list has already been verified to be non-empty.
    // Therefore, the ! operator is being used as intended. The overzealous
    // arbiters of code that maintain eslint can step aside.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const qualifiedId = this._flushQueue.pop()!

    // An invariant of this class is that _flushQueue indexes
    // _cache. So, the ! is being used as intended again.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const receipt = this._cache.get(qualifiedId)!
    this._cache.delete(qualifiedId)

    // Save to the db
    try {
      // Put this in a transaction because this has a write which is
      // dependent on a read and must be atomic or payments could be dropped.
      this._sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
        async (transaction: Transaction) => {
          const [state, isNew] = await this._receiptModel.findOrBuild({
            where: { id: receipt.id, signer: receipt.signer },
            defaults: {
              id: receipt.id,
              signature: receipt.signature,
              signer: receipt.signer,
              paymentAmount: receipt.paymentAmount.toHexString(),
            },
            transaction,
          })

          // Don't save over receipts that are already advanced
          if (!isNew) {
            const storedPaymentAmount = BigNumber.from(
              state.getDataValue('paymentAmount'),
            )
            if (storedPaymentAmount.gte(receipt.paymentAmount)) {
              return
            }
          }

          // Make sure the new payment amount and signature are set
          state.set('paymentAmount', receipt.paymentAmount.toHexString())
          state.set('signature', receipt.signature)

          // Save the new or updated receipt to the db
          await state.save()
        },
      )
    } catch (e) {
      // If we fail for whatever reason, keep this data  in the cache to flush
      // the next time around.
      //
      // This needs to go back through the normal add method,
      // rather than just inserting back into the queue.
      // The receipt may have advanced while we were trying to flush
      // it and we don't want to overwrite new data with stale data.
      this._queue(receipt)
      throw e
    }
    return true
  }

  _queue(receipt: Receipt): void {
    // This is collision resistant only because address has a fixed length.
    const qualifiedId = `${receipt.signer}${receipt.id}`
    const latest = this._cache.get(qualifiedId)
    if (latest === undefined || latest.paymentAmount.lt(receipt.paymentAmount)) {
      if (latest === undefined) {
        this._flushQueue.push(qualifiedId)
      }
      this._cache.set(qualifiedId, receipt)
    }
  }
}
