import { Wallet, utils } from 'ethers'

import { Logger, Metrics, timer } from '@tokene-q/common-ts'
import { indexerError, IndexerErrorCode } from '@graphprotocol/indexer-common'

const registerMetrics = (metrics: Metrics) => ({
  operatorEthBalance: new metrics.client.Gauge({
    name: 'indexer_agent_operator_eth_balance',
    help: 'Amount of ETH in the operator wallet; a low amount could cause transactions to fail',
    registers: [metrics.registry],
  }),
})

export async function monitorEthBalance(
  logger: Logger,
  wallet: Wallet,
  metrics: Metrics,
): Promise<void> {
  logger = logger.child({ component: 'ETHBalanceMonitor' })

  logger.info('Monitor operator ETH balance (refreshes every 120s)')

  const balanceMetrics = registerMetrics(metrics)

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
