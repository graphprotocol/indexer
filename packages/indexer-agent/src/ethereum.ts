import { providers } from 'ethers'
import { Eventual, Logger, Metrics, timer } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from '@graphprotocol/indexer-common'

export interface CreateEthereumProviderOptions {
  logger: Logger
  metrics: Metrics
  ethereum: {
    url: string
    network: string
    pollingInterval: number
  }
}

export async function createEthereumProvider({
  logger,
  metrics,
  ethereum,
}: CreateEthereumProviderOptions): Promise<
  Eventual<providers.JsonRpcProvider>
> {
  const ethProviderMetrics = {
    requests: new metrics.client.Counter({
      name: 'eth_provider_requests',
      help: 'Ethereum provider requests',
      registers: [metrics.registry],
      labelNames: ['method'],
    }),
  }

  const recreateEthereumProvider = async (): Promise<
    providers.JsonRpcProvider
  > => {
    logger.info(`Reconnect to Ethereum`)

    let providerUrl
    try {
      providerUrl = new URL(ethereum.url)
    } catch (err) {
      logger.fatal(`Invalid Ethereum URL`, {
        err: indexerError(IndexerErrorCode.IE002, err),
        url: ethereum.url,
      })
      process.exit(1)
    }

    if (providerUrl.password && providerUrl.protocol == 'http:') {
      logger.warn(
        'Ethereum endpoint does not use HTTPS, your authentication credentials may not be secure',
      )
    }

    const ethereumProvider = new providers.JsonRpcProvider(
      {
        url: providerUrl.toString(),
        user: providerUrl.username,
        password: providerUrl.password,
        allowInsecureAuthentication: true,
      },
      ethereum.network,
    )
    ethereumProvider.pollingInterval = ethereum.pollingInterval

    await ethereumProvider.ready

    ethereumProvider.on('debug', info => {
      if (info.action === 'response') {
        ethProviderMetrics.requests.inc({
          method: info.request.method,
        })

        logger.trace('Ethereum request', {
          method: info.request.method,
          params: info.request.params,
          response: info.response,
        })
      }
    })

    ethereumProvider.on('network', (newNetwork, oldNetwork) => {
      logger.trace('Ethereum network change', {
        oldNetwork: oldNetwork,
        newNetwork: newNetwork,
      })
    })

    logger.info(`Connected to Ethereum`, {
      pollingInterval: ethereum.pollingInterval,
      network: await ethereumProvider.detectNetwork(),
    })

    return ethereumProvider
  }

  return (
    timer(300_000)
      .reduce(recreateEthereumProvider, undefined)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .map(provider => provider!)
  )
}
