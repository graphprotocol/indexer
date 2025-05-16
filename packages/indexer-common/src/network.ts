import {
  Logger,
  Metrics,
  SubgraphDeploymentID,
  Eventual,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  connectGraphHorizon,
  connectSubgraphService,
  GraphHorizonContracts,
  SubgraphServiceContracts,
} from '@graphprotocol/toolshed/deployments'
import {
  connectContracts as connectTapContracts,
  NetworkContracts as TapContracts,
} from '@semiotic-labs/tap-contracts-bindings'
import { FetchRequest, HDNodeWallet, JsonRpcProvider, Provider, Wallet } from 'ethers'
import { strict as assert } from 'assert'
import geohash from 'ngeohash'
import pRetry, { Options } from 'p-retry'

import {
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  SubgraphClient,
  TransactionManager,
  specification as spec,
  GraphNode,
  NetworkMonitor,
  AllocationReceiptCollector,
  SubgraphFreshnessChecker,
  monitorEligibleAllocations,
} from '.'
import { resolveChainId } from './indexer-management'
import { monitorEthBalance } from './utils'
import { QueryFeeModels } from './query-fees'
import { TapCollector } from './allocations/tap-collector'

export class Network {
  logger: Logger
  networkSubgraph: SubgraphClient
  contracts: GraphHorizonContracts & SubgraphServiceContracts
  wallet: HDNodeWallet
  networkProvider: JsonRpcProvider
  transactionManager: TransactionManager
  networkMonitor: NetworkMonitor

  // TODO: deprecated
  receiptCollector: AllocationReceiptCollector | undefined

  tapCollector: TapCollector | undefined
  specification: spec.NetworkSpecification
  paused: Eventual<boolean>
  isOperator: Eventual<boolean>

  private constructor(
    logger: Logger,
    contracts: GraphHorizonContracts & SubgraphServiceContracts,
    wallet: HDNodeWallet,
    networkSubgraph: SubgraphClient,
    networkProvider: JsonRpcProvider,
    transactionManager: TransactionManager,
    networkMonitor: NetworkMonitor,
    receiptCollector: AllocationReceiptCollector | undefined,
    tapCollector: TapCollector | undefined,
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
    this.tapCollector = tapCollector
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

    const networkSubgraph = await SubgraphClient.create({
      name: 'NetworkSubgraph',
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
    const tapSubgraphFreshnessChecker = new SubgraphFreshnessChecker(
      'TAP Subgraph',
      networkProvider,
      specification.subgraphs.maxBlockDistance,
      specification.subgraphs.freshnessSleepMilliseconds,
      logger.child({ component: 'FreshnessChecker' }),
      Infinity,
    )

    let tapSubgraph: SubgraphClient | undefined = undefined
    if (specification.subgraphs.tapSubgraph) {
      const tapSubgraphDeploymentId = specification.subgraphs.tapSubgraph.deployment
        ? new SubgraphDeploymentID(specification.subgraphs.tapSubgraph.deployment)
        : undefined
      tapSubgraph = await SubgraphClient.create({
        name: 'TapSubgraph',
        logger,
        deployment:
          tapSubgraphDeploymentId !== undefined
            ? {
                graphNode,
                deployment: tapSubgraphDeploymentId,
              }
            : undefined,
        endpoint: specification.subgraphs.tapSubgraph!.url,
        subgraphFreshnessChecker: tapSubgraphFreshnessChecker,
      })
    }

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
      specification.addressBook,
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

    const epochSubgraphDeploymentId = specification.subgraphs.epochSubgraph.deployment
      ? new SubgraphDeploymentID(specification.subgraphs.epochSubgraph.deployment)
      : undefined
    const epochSubgraph = await SubgraphClient.create({
      name: 'EpochSubgraph',
      logger,
      deployment:
        epochSubgraphDeploymentId !== undefined
          ? {
              graphNode,
              deployment: epochSubgraphDeploymentId,
            }
          : undefined,
      endpoint: specification.subgraphs.epochSubgraph.url,
      subgraphFreshnessChecker: epochSubgraphFreshnessChecker,
    })

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
    // * Escrow contract
    // --------------------------------------------------------------------------------
    const networkIdentifier = await networkProvider.getNetwork()
    let tapContracts: TapContracts | undefined = undefined
    if (tapSubgraph) {
      try {
        tapContracts = await connectTapContracts(
          wallet,
          Number(networkIdentifier.chainId),
          specification.tapAddressBook,
        )
      } catch (err) {
        logger.error(`Failed to connect to tap contract bindings:`, { err })
        throw err
      }
    }
    // --------------------------------------------------------------------------------
    // * Allocation and allocation signers
    // --------------------------------------------------------------------------------
    const allocations = monitorEligibleAllocations({
      indexer: toAddress(specification.indexerOptions.address),
      logger,
      networkSubgraph,
      protocolNetwork: resolveChainId(Number(networkIdentifier.chainId)),
      interval: specification.allocationSyncInterval,
    })

    // --------------------------------------------------------------------------------
    // * Allocation Receipt Collector
    // --------------------------------------------------------------------------------
    const scalarCollector: AllocationReceiptCollector | undefined = undefined
    // if (!(tapContracts && tapSubgraph)) {
    //   logger.warn(
    //     "deprecated scalar voucher collector is enabled - you probably don't want this",
    //   )
    //   scalarCollector = await AllocationReceiptCollector.create({
    //     logger,
    //     metrics,
    //     transactionManager: transactionManager,
    //     models: queryFeeModels,
    //     allocationExchange: contracts.allocationExchange,
    //     allocations,
    //     networkSpecification: specification,
    //     networkSubgraph,
    //   })
    // }

    // --------------------------------------------------------------------------------
    // * TAP Collector
    // --------------------------------------------------------------------------------
    let tapCollector: TapCollector | undefined = undefined
    if (tapContracts && tapSubgraph) {
      tapCollector = TapCollector.create({
        logger,
        metrics,
        transactionManager: transactionManager,
        models: queryFeeModels,
        tapContracts,
        allocations,
        networkSpecification: specification,
        tapSubgraph,
        networkSubgraph,
      })
    } else {
      logger.info(`RAV process not initiated. 
        Tap Contracts: ${!!tapContracts}. 
        Tap Subgraph: ${!!tapSubgraph}.`)
    }

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
      scalarCollector,
      tapCollector,
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
  ): Promise<JsonRpcProvider> {
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

    const providerFetchRequest = new FetchRequest(providerUrl.toString())
    if (username !== undefined && password !== undefined) {
      providerFetchRequest.setCredentials(username, password)
      providerFetchRequest.allowInsecureAuthentication = true
    }

    const networkProvider = new JsonRpcProvider(providerFetchRequest)
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
      provider: providerFetchRequest.url,
      pollingInterval: networkProvider.pollingInterval,
      network: await networkProvider.getNetwork(),
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
          const isRegistered = await this.contracts.LegacyServiceRegistry.isRegistered(
            this.specification.indexerOptions.address,
          )
          if (isRegistered) {
            const service = await this.contracts.LegacyServiceRegistry.services(
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
              this.contracts.LegacyServiceRegistry.registerFor.estimateGas(
                this.specification.indexerOptions.address,
                this.specification.indexerOptions.url,
                geoHash,
              ),
            (gasLimit) =>
              this.contracts.LegacyServiceRegistry.registerFor(
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
          const events = receipt.logs
          const event = events.find((event) =>
            event.topics.includes(
              // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
              this.contracts.LegacyServiceRegistry.interface.getEvent('ServiceRegistered')
                ?.topicHash!,
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
  networkProvider: Provider,
  networkIdentifier: string,
  mnemonic: string,
  logger: Logger,
): Promise<HDNodeWallet> {
  logger.info(`Connect wallet`, {
    networkIdentifier: networkIdentifier,
  })
  let wallet = Wallet.fromPhrase(mnemonic)
  wallet = wallet.connect(networkProvider)
  logger.info(`Connected wallet`)
  return wallet
}

async function connectToProtocolContracts(
  wallet: HDNodeWallet,
  networkIdentifier: string,
  logger: Logger,
  addressBook?: string,
): Promise<GraphHorizonContracts & SubgraphServiceContracts> {
  const numericNetworkId = parseInt(networkIdentifier.split(':')[1])

  // Confidence check: Should be unreachable since NetworkSpecification was validated before
  if (resolveChainId(numericNetworkId) !== networkIdentifier) {
    throw new Error(`Invalid network identifier: ${networkIdentifier}`)
  }

  logger.info(`Connect to contracts`, {
    network: networkIdentifier,
  })

  let contracts: GraphHorizonContracts & SubgraphServiceContracts
  try {
    const horizonContracts = connectGraphHorizon(numericNetworkId, wallet, addressBook)
    const subgraphServiceContracts = connectSubgraphService(
      numericNetworkId,
      wallet,
      addressBook,
    )
    contracts = {
      ...horizonContracts,
      ...subgraphServiceContracts,
    }
  } catch (error) {
    const errorMessage =
      'Failed to connect to contracts, please ensure you are using the intended protocol network.'
    logger.error(errorMessage, { error, networkIdentifier, numericNetworkId })
    throw new Error(`${errorMessage} Error: ${error}`)
  }
  logger.info(`Successfully connected to contracts`, {
    curation: contracts.L2Curation.target,
    disputeManager: contracts.DisputeManager.target,
    epochManager: contracts.EpochManager.target,
    gns: contracts.L2GNS.target,
    rewardsManager: contracts.RewardsManager.target,
    serviceRegistry: contracts.LegacyServiceRegistry.target,
    staking: contracts.HorizonStaking.target,
    token: contracts.GraphToken.target,
  })
  return contracts
}
