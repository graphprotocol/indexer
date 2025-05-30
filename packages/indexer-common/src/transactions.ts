import {
  BigNumberish,
  HDNodeWallet,
  parseUnits,
  Provider,
  TransactionReceipt,
  TransactionRequest,
  ContractTransactionResponse,
  TransactionResponse,
  toUtf8String,
  FeeData,
  Interface,
  Result,
} from 'ethers'
import { Eventual, Logger } from '@graphprotocol/common-ts'
import delay from 'delay'
import { TransactionMonitoring } from './network-specification'
import { IndexerError, indexerError, IndexerErrorCode } from './errors'
import { TransactionConfig, TransactionType } from './types'
import { SubgraphClient } from './subgraph-client'
import gql from 'graphql-tag'
import { sequentialTimerReduce } from './sequential-timer'
import {
  GraphHorizonContracts,
  SubgraphServiceContracts,
} from '@graphprotocol/toolshed/deployments'

export class TransactionManager {
  ethereum: Provider
  wallet: HDNodeWallet
  paused: Eventual<boolean>
  isOperator: Eventual<boolean>
  specification: TransactionMonitoring
  adjustedGasIncreaseFactor: bigint
  adjustedBaseFeePerGasMax: number

  constructor(
    ethereum: Provider,
    wallet: HDNodeWallet,
    paused: Eventual<boolean>,
    isOperator: Eventual<boolean>,
    specification: TransactionMonitoring,
  ) {
    this.ethereum = ethereum
    this.wallet = wallet
    this.paused = paused
    this.isOperator = isOperator
    this.specification = specification
    this.adjustedGasIncreaseFactor = parseUnits(
      specification.gasIncreaseFactor.toString(),
      3,
    )
    this.adjustedBaseFeePerGasMax =
      specification.baseFeePerGasMax || specification.gasPriceMax
  }

  async executeTransaction(
    gasEstimation: () => Promise<bigint>,
    transaction: (gasLimit: BigNumberish) => Promise<ContractTransactionResponse>,
    logger: Logger,
  ): Promise<TransactionReceipt | 'paused' | 'unauthorized'> {
    if (await this.paused.value()) {
      logger.info(`Network is paused, skipping this action`)
      return 'paused'
    }

    if (!(await this.isOperator.value())) {
      logger.info(`Not authorized as an operator for indexer, skipping this action`)
      return 'unauthorized'
    }

    let pending = true
    let output: TransactionReceipt | undefined = undefined

    const feeData = await this.waitForGasPricesBelowThreshold(logger)
    const paddedGasLimit = Math.ceil(Number(await gasEstimation()) * 1.5)

    const txPromise = transaction(paddedGasLimit)
    let tx: TransactionResponse = await txPromise
    let txRequest: TransactionRequest | undefined = undefined

    let txConfig: TransactionConfig = {
      attempt: 1,
      type: await this.transactionType(feeData),
      gasBump: this.adjustedGasIncreaseFactor,
      nonce: tx.nonce,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      gasPrice: tx.gasPrice,
      gasLimit: tx.gasLimit,
    }

    logger.info(`Sending transaction`, { txConfig })

    while (pending) {
      if (
        this.specification.maxTransactionAttempts !== 0 &&
        txConfig.attempt > this.specification.maxTransactionAttempts
      ) {
        logger.warn('Transaction retry limit reached, giving up', {
          txConfig,
        })
        await delay(30000)
        break
      }

      try {
        if (txConfig.attempt > 1) {
          logger.info('Resubmitting transaction', {
            txConfig,
          })
          txRequest = {
            value: tx.value,
            to: tx.to,
            data: tx.data,
            chainId: tx.chainId,
            from: tx.from,
            nonce: txConfig.nonce,
            gasPrice: txConfig.gasPrice,
            maxPriorityFeePerGas: txConfig.maxPriorityFeePerGas,
            maxFeePerGas: txConfig.maxFeePerGas,
            gasLimit: txConfig.gasLimit,
          }
          tx = await this.wallet.sendTransaction(txRequest)
        }

        logger.info(`Transaction pending`, {
          tx: tx,
          confirmationBlocks: this.specification.confirmationBlocks,
        })

        const receipt = await this.ethereum.waitForTransaction(
          tx.hash,
          this.specification.confirmationBlocks,
          this.specification.gasIncreaseTimeout,
        )

        if (receipt === null) {
          throw indexerError(IndexerErrorCode.IE057)
        }

        if (receipt.status == 0) {
          const revertReason = await this.getRevertReason(
            logger,
            txRequest as TransactionRequest,
          )
          if (revertReason === 'out of gas') {
            throw indexerError(IndexerErrorCode.IE050)
          } else if (revertReason === 'unknown') {
            throw indexerError(IndexerErrorCode.IE051)
          } else {
            throw indexerError(IndexerErrorCode.IE057)
          }
        }

        logger.info(`Transaction successfully included in block`, {
          tx: tx.hash,
          receipt: receipt,
        })
        output = receipt
        pending = false
      } catch (error) {
        txConfig = await this.updateTransactionConfig(logger, txConfig, error)
        continue
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return output!
  }

  async getRevertReason(logger: Logger, txRequest: TransactionRequest): Promise<string> {
    let revertReason = 'unknown'
    try {
      const code = await this.ethereum.call(txRequest)
      revertReason = toUtf8String(`0x${code.substr(138)}`)
    } catch (e) {
      if (e.body.includes('out of gas')) {
        revertReason = 'out of gas'
      } else {
        throw indexerError(IndexerErrorCode.IE051)
      }
    }
    logger.warn('Transaction reverted:', { reason: revertReason })
    return revertReason
  }

  async updateTransactionConfig(
    logger: Logger,
    txConfig: TransactionConfig,
    error: Error | IndexerError,
  ): Promise<TransactionConfig> {
    logger.warning('Failed to send transaction, evaluating retry possibilities', {
      error: error.message,
    })
    if (error instanceof IndexerError) {
      if (error.code == IndexerErrorCode.IE050) {
        if (txConfig.gasLimit) {
          txConfig.gasLimit = (BigInt(txConfig.gasLimit) * txConfig.gasBump) / 1000n
        }
        if (txConfig.nonce) {
          txConfig.nonce = txConfig.nonce + 1
        }
      } else if (error.code == IndexerErrorCode.IE051) {
        throw error
      }
    } else if (error instanceof Error) {
      if (
        error.message.includes('Transaction with the same hash was already imported') ||
        error.message.includes('nonce has already been used')
      ) {
        // This case typically indicates a successful transaction being retried.
        // Let's introduce a 30 second delay to ensure the previous transaction has
        // a chance to be mined and return to the reconciliation loop so the agent can reevaluate.
        await delay(30000)
        throw indexerError(
          IndexerErrorCode.IE058,
          `Original transaction was not confirmed though it may have been successful`,
        )
      } else if (
        error.message.includes(
          'Transaction nonce is too low. Try incrementing the nonce.',
        )
      ) {
        if (txConfig.nonce) {
          txConfig.nonce = txConfig.nonce + 1
        }
      } else if (
        error.message.includes('Try increasing the fee') ||
        error.message.includes('gas price supplied is too low') ||
        error.message?.includes('timeout exceeded')
      ) {
        // Transaction timed out or failed due to a low gas price estimation, bump gas price and retry
        if (txConfig.type === TransactionType.ZERO) {
          if (txConfig.gasPrice) {
            txConfig.gasPrice = (BigInt(txConfig.gasPrice) * txConfig.gasBump) / 1000n
          }
        } else if (txConfig.type == TransactionType.TWO) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          if (txConfig.maxFeePerGas) {
            txConfig.maxFeePerGas =
              (BigInt(txConfig.maxFeePerGas) * txConfig.gasBump) / 1000n
          }
          if (txConfig.maxPriorityFeePerGas) {
            txConfig.maxPriorityFeePerGas =
              (BigInt(txConfig.maxPriorityFeePerGas) * txConfig.gasBump) / 1000n
          }
        }
      }
    }
    txConfig.attempt += 1
    return txConfig
  }
  async transactionType(data: FeeData): Promise<TransactionType> {
    if (data.maxPriorityFeePerGas && data.maxFeePerGas) {
      return TransactionType.TWO
    } else if (data.gasPrice) {
      return TransactionType.ZERO
    } else {
      throw new Error(
        `Network fee data failed validation: gasPrice: ${data.gasPrice}, maxPriorityFeePerGas: ${data.maxPriorityFeePerGas}, maxFeePerGass: ${data.maxFeePerGas}`,
      )
    }
  }
  async waitForGasPricesBelowThreshold(logger: Logger): Promise<FeeData> {
    let attempt = 1
    let aboveThreshold = true
    let feeData = {
      gasPrice: null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    } as {
      gasPrice: bigint | null
      maxFeePerGas: bigint | null
      maxPriorityFeePerGas: bigint | null
    }

    while (aboveThreshold) {
      const providerFeeData = await this.ethereum.getFeeData()
      feeData = {
        gasPrice: providerFeeData.gasPrice,
        maxFeePerGas: providerFeeData.maxFeePerGas,
        maxPriorityFeePerGas: providerFeeData.maxPriorityFeePerGas,
      }
      const type = await this.transactionType(providerFeeData)
      if (type === TransactionType.TWO) {
        // Type 0x02 transaction
        // This baseFeePerGas calculation is based off how maxFeePerGas is calculated in getFeeData()
        // https://github.com/ethers-io/ethers.js/blob/68229ac0aff790b083717dc73cd84f38d32a3926/packages/abstract-provider/src.ts/index.ts#L247
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const baseFeePerGas =
          (feeData.maxFeePerGas! - // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            feeData.maxPriorityFeePerGas!) /
          2n
        if (Number(baseFeePerGas) >= this.adjustedBaseFeePerGasMax) {
          if (attempt === 1) {
            logger.warning(
              `Max base fee per gas has been reached, waiting until the base fee falls below to resume transaction execution.`,
              { maxBaseFeePerGas: this.specification.baseFeePerGasMax, baseFeePerGas },
            )
          } else {
            logger.info(`Base gas fee per gas estimation still above max threshold`, {
              maxBaseFeePerGas: this.specification.baseFeePerGasMax,
              baseFeePerGas: Number(baseFeePerGas),
              priceEstimateAttempt: attempt,
            })
          }
          await delay(30000)
          attempt++
        } else {
          aboveThreshold = false
          feeData.gasPrice = null
        }
      } else if (type === TransactionType.ZERO) {
        // Legacy transaction type
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (Number(feeData.gasPrice!) >= this.adjustedBaseFeePerGasMax) {
          if (attempt === 1) {
            logger.warning(
              `Max gas price has been reached, waiting until gas price estimates fall below to resume transaction execution.`,
              {
                baseFeePerGasMax: this.specification.baseFeePerGasMax,
                currentGasPriceEstimate: Number(feeData.gasPrice!),
              },
            )
          } else {
            logger.info(`Gas price estimation still above max threshold`, {
              baseFeePerGasMax: this.specification.baseFeePerGasMax,
              currentGasPriceEstimate: Number(feeData.gasPrice!),
              priceEstimateAttempt: attempt,
            })
          }
          await delay(30000)
          attempt++
        } else {
          aboveThreshold = false
        }
      }
    }
    return feeData as FeeData
  }

  async monitorNetworkPauses(
    logger: Logger,
    contracts: GraphHorizonContracts & SubgraphServiceContracts,
    networkSubgraph: SubgraphClient,
  ): Promise<Eventual<boolean>> {
    return sequentialTimerReduce(
      {
        logger,
        milliseconds: 60_000,
      },
      async (currentlyPaused) => {
        try {
          const result = await networkSubgraph.checkedQuery(gql`
            {
              graphNetworks {
                isPaused
              }
            }
          `)

          if (result.error) {
            throw result.error
          }

          if (!result.data || result.data.length === 0) {
            throw new Error(`No data returned by network subgraph`)
          }

          return result.data.graphNetworks[0].isPaused
        } catch (err) {
          logger.warn(`Failed to check for network pause, assuming it has not changed`, {
            err: indexerError(IndexerErrorCode.IE007, err),
            paused: currentlyPaused,
          })
          return currentlyPaused
        }
      },
      await contracts.Controller.paused(),
    ).map((paused) => {
      logger.info(paused ? `Network paused` : `Network active`)
      return paused
    })
  }

  findEvent(
    eventType: string,
    contractInterface: Interface,
    logKey: string,
    logValue: string,
    receipt: TransactionReceipt,
    logger: Logger,
  ): Result | undefined {
    const events = receipt.logs
    const decodedEvents: Result[] = []
    const expectedEvent = contractInterface.getEvent(eventType)
    const expectedTopicHash = expectedEvent?.topicHash

    // TODO HORIZON - throw indexer error here
    if (!expectedTopicHash) {
      throw new Error(`Event type ${eventType} not found in contract interface`)
    }

    const result = events
      .filter((event) => event.topics.includes(expectedTopicHash))
      .map((event) => {
        const decoded = contractInterface.decodeEventLog(
          expectedEvent,
          event.data,
          event.topics,
        )
        decodedEvents.push(decoded)
        return decoded
      })
      .find((eventLogs) => {
        return (
          eventLogs[logKey] &&
          eventLogs[logKey].toString().toLocaleLowerCase() ===
            logValue.toLocaleLowerCase()
        )
      })

    logger.trace('Searched for event logs', {
      function: 'findEvent',
      expectedTopicHash,
      events,
      decodedEvents,
      eventType,
      logKey,
      logValue,
      receipt,
      found: !!result,
      result,
    })

    return result
  }
}
