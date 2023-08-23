import { Wallet, utils } from 'ethers'
import {
  BaseProvider,
  JsonRpcProvider,
  getDefaultProvider,
} from '@ethersproject/providers'
import { Logger, Metrics, timer } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from './errors'
import { Sequelize } from 'sequelize'

export const parseBoolean = (
  val: string | boolean | number | undefined | null,
): boolean => {
  const s = val && val.toString().toLowerCase().trim()
  return s != 'false' && s != 'f' && s != '0'
}

export function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

export function getTestProvider(network: string): BaseProvider {
  const testJsonRpcProviderUrl = process.env.INDEXER_TEST_JRPC_PROVIDER_URL
  if (testJsonRpcProviderUrl) {
    return new JsonRpcProvider(testJsonRpcProviderUrl)
  } else {
    return getDefaultProvider(network)
  }
}

const registerMetrics = (metrics: Metrics, networkIdentifier: string) => ({
  operatorEthBalance: new metrics.client.Gauge({
    name: `indexer_agent_operator_eth_balance_${networkIdentifier}`,
    help: 'Amount of ETH in the operator wallet; a low amount could cause transactions to fail',
    registers: [metrics.registry],
  }),
})

export async function monitorEthBalance(
  logger: Logger,
  wallet: Wallet,
  metrics: Metrics,
  networkIdentifier: string,
): Promise<void> {
  logger = logger.child({ component: 'ETHBalanceMonitor' })

  logger.info('Monitor operator ETH balance (refreshes every 120s)')

  const balanceMetrics = registerMetrics(metrics, networkIdentifier)

  timer(120_000).pipe(async () => {
    try {
      const balance = await wallet.getBalance()
      const eth = parseFloat(utils.formatEther(balance))
      balanceMetrics.operatorEthBalance.set(eth)
      logger.info('Current operator ETH balance', {
        balance: eth,
      })
    } catch (error) {
      logger.warn(`Failed to check latest ETH balance`, {
        err: indexerError(IndexerErrorCode.IE059),
      })
    }
  })
}
