import { Token, Fetcher, Route } from '@uniswap/sdk'
import { Gauge } from 'prom-client'

import {
  Logger,
  Metrics,
  NetworkContracts,
  timer,
  Address,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient, Network } from '@graphprotocol/indexer-common'
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

// Public API
export interface StartCostModelAutomationOptions {
  logger: Logger
  networks: Network[]
  indexerManagement: IndexerManagementClient
  metrics: Metrics
}

// Internal API
interface CostModelAutomationOptions {
  logger: Logger
  ethereum: providers.BaseProvider
  contracts: NetworkContracts
  indexerManagement: IndexerManagementClient
  daiContractAddress: Address
  metrics: CostModelAutomationMetrics
}

export const startCostModelAutomation = async ({
  logger,
  networks,
  indexerManagement,
  metrics,
}: StartCostModelAutomationOptions): Promise<void> => {
  logger = logger.child({ component: 'CostModelAutomation' })

  const automationMetrics = registerMetrics(metrics)

  // We could have this run per network but we probably only need to run it for Mainnet
  const mainnet = networks.find(
    n => n.specification.networkIdentifier === 'eip155:1',
  )
  if (mainnet && mainnet.specification.dai.inject) {
    await monitorAndInjectDai({
      logger,
      ethereum: mainnet.networkProvider,
      contracts: mainnet.contracts,
      indexerManagement,
      metrics: automationMetrics,
      daiContractAddress: mainnet.specification.dai.contractAddress,
    })
  }
}

const ERC20_ABI = ['function decimals() view returns (uint8)']

const monitorAndInjectDai = async ({
  logger,
  ethereum,
  contracts,
  indexerManagement,
  metrics,
  daiContractAddress,
}: CostModelAutomationOptions): Promise<void> => {
  // Identify the decimals used by the DAI or USDC contract
  const chainId = ethereum.network.chainId
  const stableCoin = new Contract(daiContractAddress, ERC20_ABI, ethereum)
  const decimals = await stableCoin.decimals()

  const DAI = new Token(chainId, daiContractAddress, decimals)
  const GRT = new Token(chainId, contracts.token.address, 18)

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
