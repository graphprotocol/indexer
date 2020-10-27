import { ChainId, Token, Fetcher, Route } from '@uniswap/sdk'
import gql from 'graphql-tag'
import { Gauge } from 'prom-client'

import {
  Logger,
  Metrics,
  NetworkContracts,
  SubgraphDeploymentID,
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
  injectGrtPerDaiConversionVariable: boolean
  metrics: Metrics
}

export const startCostModelAutomation = ({
  logger,
  ethereum,
  contracts,
  indexerManagement,
  injectGrtPerDaiConversionVariable,
  metrics,
}: CostModelAutomationOptions): void => {
  logger = logger.child({ component: 'CostModelAutomation' })

  const automationMetrics = registerMetrics(metrics)

  if (injectGrtPerDaiConversionVariable) {
    monitorAndInjectDaiConversionRate({
      logger,
      ethereum,
      contracts,
      indexerManagement,
      metrics: automationMetrics,
    })
  }
}

const monitorAndInjectDaiConversionRate = ({
  logger,
  ethereum,
  contracts,
  indexerManagement,
  metrics,
}: Omit<
  CostModelAutomationOptions,
  'injectGrtPerDaiConversionVariable' | 'metrics'
> & { metrics: CostModelAutomationMetrics }): void => {
  // FIXME: Make this mainnet-compatible by picking the REAL DAI address?
  const DAI = new Token(
    ChainId.RINKEBY,
    '0xFb49BDaA59d4B7aE6260D22b7D86e6Fe94031b82',
    18,
  )

  const GRT = new Token(ChainId.RINKEBY, contracts.token.address, 18)

  timer(120 * 1000).pipe(async () => {
    const pair = await Fetcher.fetchPairData(GRT, DAI, ethereum)
    const route = new Route([pair], DAI)
    const grtPerDai = route.midPrice.toSignificant(18)
    const daiPerGrt = route.midPrice.invert().toSignificant(18)

    // Observe conversion rate in metrics
    metrics.daiPerGrt.set(parseFloat(daiPerGrt))
    metrics.grtPerDai.set(parseFloat(grtPerDai))

    logger.info(
      'Updating cost models with GRT per DAI conversion rate variable ($DAI)',
      { value: grtPerDai },
    )

    const result = await indexerManagement
      .query(
        gql`
          {
            costModels {
              deployment
              variables
            }
          }
        `,
      )
      .toPromise()

    if (result.error) {
      logger.warn(`Failed to query cost models`, {
        error: result.error.message || result.error,
      })
      return
    }

    if (!result.data || !result.data.costModels) {
      logger.warn(`No cost models found`)
      return
    }

    for (const costModel of result.data.costModels) {
      const deployment = new SubgraphDeploymentID(costModel.deployment)

      try {
        logger.trace(
          `Update cost model with GRT per DAI conversion rate variable ($DAI)`,
          {
            deployment: deployment.display,
            grtPerDai: `${grtPerDai}`,
          },
        )

        costModel.variables = JSON.stringify({
          ...JSON.parse(costModel.variables),
          DAI: `${grtPerDai}`,
        })

        const result = await indexerManagement
          .mutation(
            gql`
              mutation setCostModel($costModel: CostModelInput!) {
                setCostModel(costModel: $costModel) {
                  deployment
                }
              }
            `,
            {
              costModel,
            },
          )
          .toPromise()

        if (result.error) {
          throw result.error
        }
      } catch (error) {
        logger.warn(
          `Failed to update cost model with GRT per DAI conversion rate variable ($DAI)`,
          {
            deployment: deployment.display,
            error: error.message || error,
          },
        )
      }
    }
  })
}
