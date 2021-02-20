import {
  BigNumber,
  BigNumberish,
  ContractReceipt,
  ContractTransaction,
} from 'ethers'
import { Eventual, Logger } from '@graphprotocol/common-ts'

export async function executeTransaction(
  logger: Logger,
  paused: Eventual<boolean>,
  isOperator: Eventual<boolean>,
  gasEstimation: () => Promise<BigNumber>,
  transaction: (gasLimit: BigNumberish) => Promise<ContractTransaction>,
): Promise<ContractReceipt | 'paused' | 'unauthorized'> {
  if (await paused.value()) {
    logger.info(`Network is paused, skipping this action`)
    return 'paused'
  }

  if (!(await isOperator.value())) {
    logger.info(
      `Not authorized as an operator for indexer, skipping this action`,
    )
    return 'unauthorized'
  }

  const estimatedGas = await gasEstimation()
  const tx = await transaction(Math.ceil(estimatedGas.toNumber() * 1.5))
  logger.info(`Transaction pending`, { tx: tx.hash })
  const receipt = await tx.wait(1)
  logger.info(`Transaction successfully included in block`, {
    tx: tx.hash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
  })
  return receipt
}
