import { ChainId, Token, Fetcher, Route } from '@uniswap/sdk'
import { Gauge } from 'prom-client'

import {
  Logger,
  Metrics,
  NetworkContracts,
  timer,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import { providers } from 'ethers'

interface CostModelAutomationMetrics {
  grtPerDai: Gauge<string>
  daiPerGrt: Gauge<string>
}

const registerMetrics = (metrics: Metrics): CostModelAutomationMetrics => ({
  grtPerDai: new metrics.client.Gauge({
    name: 'cost_model_automation_grt_per_dai',
    help: 'Conversion rate from GRT to DAI',
    registers: [metrics.registry],
  }),

  daiPerGrt: new metrics.client.Gauge({
    name: 'cost_model_automation_dai_per_grt',
    help: 'Conversion rate from DAI to GRT',
    registers: [metrics.registry],
  }),
})

export interface CostModelAutomationOptions {
  logger: Logger
  ethereum: providers.JsonRpcProvider
  contracts: NetworkContracts
  indexerManagement: IndexerManagementClient
  injectDai: boolean
  metrics: Metrics
}

export const startCostModelAutomation = ({
  logger,
  ethereum,
  contracts,
  indexerManagement,
  injectDai,
  metrics,
}: CostModelAutomationOptions): void => {
  logger = logger.child({ component: 'CostModelAutomation' })

  const automationMetrics = registerMetrics(metrics)

  if (injectDai) {
    monitorAndInjectDai({
      logger,
      ethereum,
      contracts,
      indexerManagement,
      metrics: automationMetrics,
    })
  }
}

const monitorAndInjectDai = ({
  logger,
  ethereum,
  contracts,
  indexerManagement,
  metrics,
}: Omit<CostModelAutomationOptions, 'injectDai' | 'metrics'> & {
  metrics: CostModelAutomationMetrics
}): void => {
  // FIXME: Make this mainnet-compatible by picking the REAL DAI address?
  const DAI = new Token(
    ChainId.RINKEBY,
    '0xFb49BDaA59d4B7aE6260D22b7D86e6Fe94031b82',
    18,
  )

  const GRT = new Token(ChainId.RINKEBY, contracts.token.address, 18)

  // Update the GRT per DAI conversion rate every 15 minutes
  timer(15 * 60 * 1000).pipe(async () => {
    const pair = await Fetcher.fetchPairData(GRT, DAI, ethereum)
    const route = new Route([pair], DAI)
    const grtPerDai = route.midPrice.toSignificant(18)
    const daiPerGrt = route.midPrice.invert().toSignificant(18)

    // Observe conversion rate in metrics
    metrics.daiPerGrt.set(parseFloat(daiPerGrt))
    metrics.grtPerDai.set(parseFloat(grtPerDai))

    logger.info('Update $DAI variable', { value: grtPerDai })
    await indexerManagement.setDai(grtPerDai)
  })
}
