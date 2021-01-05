import { Token, Fetcher, Route } from '@uniswap/sdk'
import { Gauge } from 'prom-client'

import {
  Logger,
  Metrics,
  NetworkContracts,
  timer,
  Address,
  Eventual,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import { Contract, providers } from 'ethers'

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
  ethereumProvider: Eventual<providers.StaticJsonRpcProvider>
  contracts: Eventual<NetworkContracts>
  indexerManagement: IndexerManagementClient
  injectDai: boolean
  daiContractAddress: Address
  metrics: Metrics
}

export const startCostModelAutomation = ({
  logger,
  ethereumProvider,
  contracts,
  indexerManagement,
  injectDai,
  daiContractAddress,
  metrics,
}: CostModelAutomationOptions): void => {
  logger = logger.child({ component: 'CostModelAutomation' })

  const automationMetrics = registerMetrics(metrics)

  if (injectDai) {
    monitorAndInjectDai({
      logger,
      ethereumProvider,
      contracts,
      indexerManagement,
      metrics: automationMetrics,
      daiContractAddress,
    })
  }
}

const ERC20_ABI = ['function decimals() view returns (uint8)']

const monitorAndInjectDai = async ({
  logger,
  ethereumProvider,
  contracts,
  indexerManagement,
  metrics,
  daiContractAddress,
}: Omit<CostModelAutomationOptions, 'injectDai' | 'metrics'> & {
  metrics: CostModelAutomationMetrics
}): Promise<void> => {
  const oneTimeEthereumProvider = await ethereumProvider.value()
  const oneTimeContracts = await contracts.value()

  // Identify the decimals used by the DAI or USDC contract
  const chainId = oneTimeEthereumProvider.network.chainId
  const stableCoin = new Contract(
    daiContractAddress,
    ERC20_ABI,
    oneTimeEthereumProvider,
  )
  const decimals = await stableCoin.decimals()

  const DAI = new Token(chainId, daiContractAddress, decimals)
  const GRT = new Token(chainId, oneTimeContracts.token.address, 18)

  // Update the GRT per DAI conversion rate every 15 minutes
  timer(15 * 60 * 1000).pipe(async () => {
    const provider = await ethereumProvider.value()
    const pair = await Fetcher.fetchPairData(GRT, DAI, provider)
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
