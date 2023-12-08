import {
  Logger,
  Metrics,
  NetworkContracts,
  SubgraphDeploymentID,
  connectContracts,
  Eventual,
} from '@graphprotocol/common-ts'
import {
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  NetworkSubgraph,
  TransactionManager,
  specification as spec,
  GraphNode,
  EpochSubgraph,
  NetworkMonitor,
  AllocationReceiptCollector,
  SubgraphFreshnessChecker,
} from '.'
import { providers, Wallet } from 'ethers'
import { strict as assert } from 'assert'
import geohash from 'ngeohash'

import pRetry, { Options } from 'p-retry'
import { resolveChainId } from './indexer-management'
import { monitorEthBalance } from './utils'
import { QueryFeeModels } from './query-fees'

export class Network {
  logger: Logger
  networkSubgraph: NetworkSubgraph
  contracts: NetworkContracts
  wallet: Wallet
  networkProvider: providers.StaticJsonRpcProvider
  transactionManager: TransactionManager
  networkMonitor: NetworkMonitor
  receiptCollector: AllocationReceiptCollector
  specification: spec.NetworkSpecification
  paused: Eventual<boolean>
  isOperator: Eventual<boolean>

  private constructor(
    logger: Logger,
    contracts: NetworkContracts,
    wallet: Wallet,
    networkSubgraph: NetworkSubgraph,
    networkProvider: providers.StaticJsonRpcProvider,
    transactionManager: TransactionManager,
    networkMonitor: NetworkMonitor,
    receiptCollector: AllocationReceiptCollector,
    specification: spec.NetworkSpecification,
    paused: Eventual<boolean>,
    isOperator: Eventual<boolean>,
  ) {
    this.logger = logger
    this.contracts = contracts
    this.wallet = wallet
    this.networkSubgraph = networkSubgraph
    this.networkProvider = networkProvider
    this.transactionManager = transactionManager
    this.networkMonitor = networkMonitor
    this.receiptCollector = receiptCollector
    this.specification = specification
    this.paused = paused
    this.isOperator = isOperator
  }

  static async create(
    parentLogger: Logger,
    specification: spec.NetworkSpecification,
    queryFeeModels: QueryFeeModels,
    graphNode: GraphNode,
    metrics: Metrics,
  ): Promise<Network> {
    // Incomplete logger for initial operations, will be replaced as new labels emerge.
    let logger = parentLogger.child({
      component: 'Network',
      indexer: specification.indexerOptions.address,
      protocolNetwork: specification.networkIdentifier,
    })

    // * -----------------------------------------------------------------------
    // * Network Provider
    // * -----------------------------------------------------------------------
    const networkProvider = await Network.provider(
      logger,
      metrics,
      specification.networkIdentifier,
      specification.networkProvider.url,
      specification.networkProvider.pollingInterval,
    )

    // * -----------------------------------------------------------------------
    // * Network Subgraph
    // * -----------------------------------------------------------------------
    const networkSubgraphFreshnessChecker = new SubgraphFreshnessChecker(
      'Network Subgraph',
      networkProvider,
      specification.subgraphs.maxBlockDistance,
      specification.subgraphs.freshnessSleepMilliseconds,
      logger.child({ component: 'FreshnessChecker' }),
      Infinity,
    )

    const networkSubgraphDeploymentId = specification.subgraphs.networkSubgraph.deployment
      ? new SubgraphDeploymentID(specification.subgraphs.networkSubgraph.deployment)
      : undefined

    const networkSubgraph = await NetworkSubgraph.create({
      logger,
      endpoint: specification.subgraphs.networkSubgraph.url,
      deployment:
        networkSubgraphDeploymentId !== undefined
          ? {
              graphNode,
              deployment: networkSubgraphDeploymentId,
            }
          : undefined,
      subgraphFreshnessChecker: networkSubgraphFreshnessChecker,
    })

    // * -----------------------------------------------------------------------
    // * Contracts
    // * -----------------------------------------------------------------------
    const wallet = await connectWallet(
      networkProvider,
      specification.networkIdentifier,
      specification.indexerOptions.mnemonic,
      logger,
    )

    // Include wallet address in this logger
    logger = logger.child({
      operator: wallet.address,
    })

    // Monitor ETH balance of the operator and write the latest value to a metric
    await monitorEthBalance(logger, wallet, metrics, specification.networkIdentifier)

    const contracts = await connectToProtocolContracts(
      wallet,
      specification.networkIdentifier,
      logger,
    )

    // * -----------------------------------------------------------------------
    // * Epoch Subgraph
    // * -----------------------------------------------------------------------
    const epochSubgraphFreshnessChecker = new SubgraphFreshnessChecker(
      'Epoch Subgraph',
      networkProvider,
      specification.subgraphs.maxBlockDistance,
      specification.subgraphs.freshnessSleepMilliseconds,
      logger.child({ component: 'FreshnessChecker' }),
      Infinity,
    )

    const epochSubgraph = new EpochSubgraph(
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion --
       * Accept the non-null `url` property of the Epoch Subgraph, as it has
       * already been validated during parsing. Once indexing is supported,
       * initialize it in the same way as the NetworkSubgraph
       */
      specification.subgraphs.epochSubgraph.url!,
      epochSubgraphFreshnessChecker,
      logger.child({ component: 'EpochSubgraph' }),
    )

    // * -----------------------------------------------------------------------
    // * Network Monitor
    // * -----------------------------------------------------------------------
    const networkMonitor = new NetworkMonitor(
      specification.networkIdentifier,
      contracts,
      specification.indexerOptions,
      logger.child({
        component: 'NetworkMonitor',
        protocolNetwork: specification.networkIdentifier,
      }),
      graphNode,
      networkSubgraph,
      networkProvider,
      epochSubgraph,
    )

    // * -----------------------------------------------------------------------
    // * Transaction Manager
    // * -----------------------------------------------------------------------
    const paused = await networkMonitor.monitorNetworkPauses(
      logger,
      contracts,
      networkSubgraph,
    )

    const isOperator = await networkMonitor.monitorIsOperator(
      logger,
      contracts,
      specification.indexerOptions.address,
      wallet,
    )

    const transactionManager = new TransactionManager(
      networkProvider,
      wallet,
      paused,
      isOperator,
      specification.transactionMonitoring,
    )

    // --------------------------------------------------------------------------------
    // * Allocation Receipt Collector
    // --------------------------------------------------------------------------------
    const receiptCollector = await AllocationReceiptCollector.create({
      logger,
      metrics,
      transactionManager: transactionManager,
      models: queryFeeModels,
      allocationExchange: contracts.allocationExchange,
      networkSpecification: specification,
    })

    // --------------------------------------------------------------------------------
    // * Network
    // --------------------------------------------------------------------------------
    return new Network(
      logger,
      contracts,
      wallet,
      networkSubgraph,
      networkProvider,
      transactionManager,
      networkMonitor,
      receiptCollector,
      specification,
      paused,
      isOperator,
    )
  }

  static async provider(
    logger: Logger,
    metrics: Metrics,
    networkIdentifier: string,
    networkURL: string,
    pollingInterval: number,
  ): Promise<providers.StaticJsonRpcProvider> {
    logger.info(`Connect to Network chain`, {
      provider: networkURL,
      pollingInterval,
    })

    let providerUrl
    try {
      providerUrl = new URL(networkURL)
    } catch (err) {
      logger.fatal(`Invalid Network provider URL`, {
        err: indexerError(IndexerErrorCode.IE002, err),
        url: networkURL,
      })
      process.exit(1)
    }

    const provider_requests_metric_name = `eth_provider_requests_${networkIdentifier}`
    logger.info('Metric name: ', { provider_requests_metric_name })
    const ethProviderMetrics = {
      requests: new metrics.client.Counter({
        name: provider_requests_metric_name,
        help: 'Ethereum provider requests',
        registers: [metrics.registry],
        labelNames: ['method'],
      }),
    }

    if (providerUrl.password && providerUrl.protocol == 'http:') {
      logger.warn(
        'Network endpoint does not use HTTPS, your authentication credentials may not be secure',
      )
    }

    let username
    let password
    if (providerUrl.username == '' && providerUrl.password == '') {
      username = undefined
      password = undefined
    } else {
      username = providerUrl.username
      password = providerUrl.password
    }

    const networkProvider = new providers.StaticJsonRpcProvider({
      url: providerUrl.toString(),
      user: username,
      password: password,
      allowInsecureAuthentication: true,
    })
    networkProvider.pollingInterval = pollingInterval

    networkProvider.on('debug', (info) => {
      if (info.action === 'response') {
        ethProviderMetrics.requests.inc({
          method: info.request.method,
        })

        logger.trace('Network request', {
          method: info.request.method,
          params: info.request.params,
          response: info.response,
        })
      }
    })

    networkProvider.on('network', (newNetwork, oldNetwork) => {
      logger.trace('Network change', {
        oldNetwork: oldNetwork,
        newNetwork: newNetwork,
      })
    })

    logger.info(`Connected to network`, {
      provider: networkProvider.connection.url,
      pollingInterval: networkProvider.pollingInterval,
      network: await networkProvider.detectNetwork(),
    })

    return networkProvider
  }

  // Start of SEND functions
  async register(): Promise<void> {
    const geoHash = geohash.encode(
      +this.specification.indexerOptions.geoCoordinates[0],
      +this.specification.indexerOptions.geoCoordinates[1],
    )

    const logger = this.logger.child({
      address: this.specification.indexerOptions.address,
      url: this.specification.indexerOptions.url,
      geoCoordinates: this.specification.indexerOptions.geoCoordinates,
      geoHash,
    })

    if (!this.specification.indexerOptions.register) {
      logger.debug(
        "Indexer was not registered because it was explicitly disabled in this Network's configuration.",
      )
      return
    }

    await pRetry(
      async () => {
        try {
          logger.info(`Register indexer`)

          // Register the indexer (only if it hasn't been registered yet or
          // if its URL is different from what is registered on chain)
          const isRegistered = await this.contracts.serviceRegistry.isRegistered(
            this.specification.indexerOptions.address,
          )
          if (isRegistered) {
            const service = await this.contracts.serviceRegistry.services(
              this.specification.indexerOptions.address,
            )
            if (
              service.url === this.specification.indexerOptions.url &&
              service.geohash === geoHash
            ) {
              if (await this.transactionManager.isOperator.value()) {
                logger.info(`Indexer already registered, operator status already granted`)
              } else {
                logger.info(`Indexer already registered, operator status not yet granted`)
              }
              return
            }
          }
          const receipt = await this.transactionManager.executeTransaction(
            () =>
              this.contracts.serviceRegistry.estimateGas.registerFor(
                this.specification.indexerOptions.address,
                this.specification.indexerOptions.url,
                geoHash,
              ),
            (gasLimit) =>
              this.contracts.serviceRegistry.registerFor(
                this.specification.indexerOptions.address,
                this.specification.indexerOptions.url,
                geoHash,
                {
                  gasLimit,
                },
              ),
            logger.child({ function: 'serviceRegistry.registerFor' }),
          )
          if (receipt === 'paused' || receipt === 'unauthorized') {
            return
          }
          const events = receipt.events || receipt.logs
          const event = events.find((event) =>
            event.topics.includes(
              this.contracts.serviceRegistry.interface.getEventTopic('ServiceRegistered'),
            ),
          )
          assert.ok(event)

          logger.info(`Successfully registered indexer`)
        } catch (error) {
          const err = indexerError(IndexerErrorCode.IE012, error)
          logger.error(INDEXER_ERROR_MESSAGES[IndexerErrorCode.IE012], {
            err,
          })
          throw error
        }
      },
      { retries: 5 } as Options,
    )
  }
}

async function connectWallet(
  networkProvider: providers.Provider,
  networkIdentifier: string,
  mnemonic: string,
  logger: Logger,
): Promise<Wallet> {
  logger.info(`Connect wallet`, {
    networkIdentifier: networkIdentifier,
  })
  let wallet = Wallet.fromMnemonic(mnemonic)
  wallet = wallet.connect(networkProvider)
  logger.info(`Connected wallet`)
  return wallet
}

async function connectToProtocolContracts(
  wallet: Wallet,
  networkIdentifier: string,
  logger: Logger,
): Promise<NetworkContracts> {
  const numericNetworkId = parseInt(networkIdentifier.split(':')[1])

  // Confidence check: Should be unreachable since NetworkSpecification was validated before
  if (resolveChainId(numericNetworkId) !== networkIdentifier) {
    throw new Error(`Invalid network identifier: ${networkIdentifier}`)
  }

  logger.info(`Connect to contracts`, {
    network: networkIdentifier,
  })

  let contracts
  try {
    contracts = await connectContracts(wallet, numericNetworkId, undefined)
  } catch (error) {
    const errorMessage =
      'Failed to connect to contracts, please ensure you are using the intended protocol network.'
    logger.error(errorMessage, { error, networkIdentifier, numericNetworkId })
    throw new Error(`${errorMessage} Error: ${error}`)
  }
  logger.info(`Successfully connected to contracts`, {
    curation: contracts.curation.address,
    disputeManager: contracts.disputeManager.address,
    epochManager: contracts.epochManager.address,
    gns: contracts.gns.address,
    rewardsManager: contracts.rewardsManager.address,
    serviceRegistry: contracts.serviceRegistry.address,
    staking: contracts.staking.address,
    token: contracts.token.address,
  })
  return contracts
}
