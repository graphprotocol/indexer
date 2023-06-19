import {
  Address,
  Eventual,
  formatGRT,
  Logger,
  Metrics,
  mutable,
  NetworkContracts,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@tokene-q/common-ts'
import {
  Allocation,
  Epoch,
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  NetworkSubgraph,
  parseGraphQLAllocation,
  parseGraphQLEpochs,
  TransactionManager,
} from '@graphprotocol/indexer-common'
import { BigNumber, providers, utils, Wallet } from 'ethers'
import { strict as assert } from 'assert'
import gql from 'graphql-tag'
import geohash from 'ngeohash'
import pFilter from 'p-filter'
import pRetry from 'p-retry'

interface IndexerConfig {
  url: string
  geoCoordinates: [string, string]
  restakeRewards: boolean
  rebateClaimThreshold: BigNumber
  rebateClaimBatchThreshold: BigNumber
  rebateClaimMaxBatchSize: number
  poiDisputeMonitoring: boolean
  poiDisputableEpochs: number
}

export class Network {
  logger: Logger
  networkSubgraph: NetworkSubgraph
  contracts: NetworkContracts
  indexerAddress: Address
  ethereum: providers.StaticJsonRpcProvider
  transactionManager: TransactionManager
  indexerConfigs: IndexerConfig
  indexerUrl: string
  indexerGeoCoordinates: [string, string]

  private constructor(
    logger: Logger,
    wallet: Wallet,
    indexerAddress: Address,
    indexerUrl: string,
    geoCoordinates: [string, string],
    contracts: NetworkContracts,
    networkSubgraph: NetworkSubgraph,
    ethereum: providers.StaticJsonRpcProvider,
    paused: Eventual<boolean>,
    isOperator: Eventual<boolean>,
    restakeRewards: boolean,
    rebateClaimThreshold: BigNumber,
    rebateClaimBatchThreshold: BigNumber,
    rebateClaimMaxBatchSize: number,
    poiDisputeMonitoring: boolean,
    poiDisputableEpochs: number,
    gasIncreaseTimeout: number,
    gasIncreaseFactor: number,
    baseFeePerGasMax: number,
    maxTransactionAttempts: number,
  ) {
    this.logger = logger
    this.indexerAddress = indexerAddress
    this.indexerUrl = indexerUrl
    this.indexerGeoCoordinates = geoCoordinates
    this.contracts = contracts
    this.networkSubgraph = networkSubgraph
    this.ethereum = ethereum
    this.indexerConfigs = {
      url: indexerUrl,
      geoCoordinates: geoCoordinates,
      restakeRewards: restakeRewards,
      rebateClaimThreshold: rebateClaimThreshold,
      rebateClaimBatchThreshold: rebateClaimBatchThreshold,
      rebateClaimMaxBatchSize: rebateClaimMaxBatchSize,
      poiDisputeMonitoring: poiDisputeMonitoring,
      poiDisputableEpochs: poiDisputableEpochs,
    }

    this.transactionManager = new TransactionManager(
      ethereum,
      wallet,
      paused,
      isOperator,
      gasIncreaseTimeout,
      gasIncreaseFactor,
      baseFeePerGasMax,
      maxTransactionAttempts,
    )
  }

  static async create(
    parentLogger: Logger,
    ethereum: providers.StaticJsonRpcProvider,
    contracts: NetworkContracts,
    wallet: Wallet,
    indexerAddress: Address,
    indexerUrl: string,
    geoCoordinates: [string, string],
    networkSubgraph: NetworkSubgraph,
    restakeRewards: boolean,
    rebateClaimThreshold: BigNumber,
    rebateClaimBatchThreshold: BigNumber,
    rebateClaimMaxBatchSize: number,
    poiDisputeMonitoring: boolean,
    poiDisputableEpochs: number,
    gasIncreaseTimeout: number,
    gasIncreaseFactor: number,
    baseFeePerGasMax: number,
    maxTransactionAttempts: number,
  ): Promise<Network> {
    const logger = parentLogger.child({
      component: 'Network',
      indexer: indexerAddress.toString(),
      operator: wallet.address,
    })

    const paused = await monitorNetworkPauses(logger, contracts, networkSubgraph)
    const isOperator = await monitorIsOperator(logger, contracts, indexerAddress, wallet)

    return new Network(
      logger,
      wallet,
      indexerAddress,
      indexerUrl,
      geoCoordinates,
      contracts,
      networkSubgraph,
      ethereum,
      paused,
      isOperator,
      restakeRewards,
      rebateClaimThreshold,
      rebateClaimBatchThreshold,
      rebateClaimMaxBatchSize,
      poiDisputeMonitoring,
      poiDisputableEpochs,
      gasIncreaseTimeout,
      gasIncreaseFactor,
      baseFeePerGasMax,
      maxTransactionAttempts,
    )
  }

  static async provider(
    logger: Logger,
    metrics: Metrics,
    networkURL: string,
    pollingInterval: number,
  ): Promise<providers.StaticJsonRpcProvider> {
    logger.info(`Connect to Network chain`, {
      provider: networkURL,
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

    const ethProviderMetrics = {
      requests: new metrics.client.Counter({
        name: 'eth_provider_requests',
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

  // TODO: Move to NetworkMonitor
  async claimableAllocations(disputableEpoch: number): Promise<Allocation[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query allocations(
            $indexer: String!
            $disputableEpoch: Int!
            $minimumQueryFeesCollected: BigInt!
          ) {
            allocations(
              where: {
                indexer: $indexer
                closedAtEpoch_lte: $disputableEpoch
                queryFeesCollected_gte: $minimumQueryFeesCollected
                status: Closed
              }
              first: 1000
            ) {
              id
              indexer {
                id
              }
              queryFeesCollected
              allocatedTokens
              createdAtEpoch
              closedAtEpoch
              createdAtBlockHash
              closedAtBlockHash
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
                queryFeesAmount
              }
            }
          }
        `,
        {
          indexer: this.indexerAddress.toLocaleLowerCase(),
          disputableEpoch,
          minimumQueryFeesCollected: this.indexerConfigs.rebateClaimThreshold.toString(),
        },
      )

      if (result.error) {
        throw result.error
      }

      const totalFees: BigNumber = result.data.allocations.reduce(
        (total: BigNumber, rawAlloc: { queryFeesCollected: string }) => {
          return total.add(BigNumber.from(rawAlloc.queryFeesCollected))
        },
        BigNumber.from(0),
      )

      const parsedAllocs: Allocation[] =
        result.data.allocations.map(parseGraphQLAllocation)

      // If the total fees claimable do not meet the minimum required for batching, return an empty array
      if (
        parsedAllocs.length > 0 &&
        totalFees.lt(this.indexerConfigs.rebateClaimBatchThreshold)
      ) {
        this.logger.info(
          `Allocation rebate batch value does not meet minimum for claiming`,
          {
            batchValueGRT: formatGRT(totalFees),
            rebateClaimBatchThreshold: formatGRT(
              this.indexerConfigs.rebateClaimBatchThreshold,
            ),
            rebateClaimMaxBatchSize: this.indexerConfigs.rebateClaimMaxBatchSize,
            batchSize: parsedAllocs.length,
            allocations: parsedAllocs.map((allocation) => {
              return {
                allocation: allocation.id,
                deployment: allocation.subgraphDeployment.id.display,
                createdAtEpoch: allocation.createdAtEpoch,
                closedAtEpoch: allocation.closedAtEpoch,
                createdAtBlockHash: allocation.createdAtBlockHash,
              }
            }),
          },
        )
        return []
      }
      // Otherwise return the allos for claiming since the batch meets the minimum
      return parsedAllocs
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE011, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[IndexerErrorCode.IE011], {
        err,
      })
      throw err
    }
  }

  // TODO: Move to NetworkMonitor
  async disputableAllocations(
    currentEpoch: number,
    deployments: SubgraphDeploymentID[],
    minimumAllocation: number,
  ): Promise<Allocation[]> {
    const logger = this.logger.child({ component: 'POI Monitor' })
    if (!this.indexerConfigs.poiDisputeMonitoring) {
      logger.trace('POI monitoring disabled, skipping')
      return Promise.resolve([])
    }

    logger.debug(
      'Query network for any newly closed allocations for deployment this indexer is syncing (available reference POIs)',
    )

    let dataRemaining = true
    let allocations: Allocation[] = []

    try {
      const zeroPOI = utils.hexlify(Array(32).fill(0))
      const disputableEpoch = currentEpoch - this.indexerConfigs.poiDisputableEpochs
      let lastCreatedAt = 0
      while (dataRemaining) {
        const result = await this.networkSubgraph.query(
          gql`
            query allocations(
              $deployments: [String!]!
              $minimumAllocation: Int!
              $disputableEpoch: Int!
              $zeroPOI: String!
              $createdAt: Int!
            ) {
              allocations(
                where: {
                  createdAt_gt: $createdAt
                  subgraphDeployment_in: $deployments
                  allocatedTokens_gt: $minimumAllocation
                  closedAtEpoch_gte: $disputableEpoch
                  status: Closed
                  poi_not: $zeroPOI
                }
                first: 1000
                orderBy: createdAt
                orderDirection: asc
              ) {
                id
                createdAt
                indexer {
                  id
                }
                poi
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                closedAtBlockHash
                subgraphDeployment {
                  id
                  stakedTokens
                  signalledTokens
                  queryFeesAmount
                }
              }
            }
          `,
          {
            deployments: deployments.map((subgraph) => subgraph.bytes32),
            minimumAllocation,
            disputableEpoch,
            createdAt: lastCreatedAt,
            zeroPOI,
          },
        )

        if (result.error) {
          throw result.error
        }
        if (result.data.allocations.length == 0) {
          dataRemaining = false
        } else {
          lastCreatedAt = result.data.allocations.slice(-1)[0].createdAt
          const parsedResult: Allocation[] =
            result.data.allocations.map(parseGraphQLAllocation)
          allocations = allocations.concat(parsedResult)
        }
      }

      // Get the unique set of dispute epochs to reduce the work fetching epoch start block hashes in the next step
      let disputableEpochs = await this.epochs([
        ...allocations.reduce((epochNumbers: Set<number>, allocation: Allocation) => {
          epochNumbers.add(allocation.closedAtEpoch)
          epochNumbers.add(allocation.closedAtEpoch - 1)
          return epochNumbers
        }, new Set()),
      ])

      disputableEpochs = await Promise.all(
        disputableEpochs.map(async (epoch: Epoch): Promise<Epoch> => {
          // TODO: May need to retry or skip epochs where obtaining start block fails
          epoch.startBlockHash = (await this.ethereum.getBlock(epoch.startBlock))?.hash
          return epoch
        }),
      )

      return await Promise.all(
        allocations.map(async (allocation) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          allocation.closedAtEpochStartBlockHash = disputableEpochs.find(
            (epoch) => epoch.id == allocation.closedAtEpoch,
          )!.startBlockHash
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          allocation.previousEpochStartBlockHash = disputableEpochs.find(
            (epoch) => epoch.id == allocation.closedAtEpoch - 1,
          )!.startBlockHash
          return allocation
        }),
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE037, error)
      logger.error(INDEXER_ERROR_MESSAGES.IE037, {
        err,
      })
      throw err
    }
  }

  async epochs(epochNumbers: number[]): Promise<Epoch[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query epochs($epochs: [Int!]!) {
            epoches(where: { id_in: $epochs }, first: 1000) {
              id
              startBlock
              endBlock
              signalledTokens
              stakeDeposited
              queryFeeRebates
              totalRewards
              totalIndexerRewards
              totalDelegatorRewards
            }
          }
        `,
        {
          epochs: epochNumbers,
        },
      )

      if (result.error) {
        throw result.error
      }
      return result.data.epoches.map(parseGraphQLEpochs)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE038, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[IndexerErrorCode.IE038], {
        err,
      })
      throw err
    }
  }

  // Start of SEND functions
  async register(): Promise<void> {
    const geoHash = geohash.encode(
      +this.indexerConfigs.geoCoordinates[0],
      +this.indexerConfigs.geoCoordinates[1],
    )

    const logger = this.logger.child({
      address: this.indexerAddress,
      url: this.indexerConfigs.url,
      geoCoordinates: this.indexerConfigs.geoCoordinates,
      geoHash,
    })

    await pRetry(
      async () => {
        try {
          logger.info(`Register indexer`)

          // Register the indexer (only if it hasn't been registered yet or
          // if its URL is different from what is registered on chain)
          const isRegistered = await this.contracts.serviceRegistry.isRegistered(
            this.indexerAddress,
          )
          if (isRegistered) {
            const service = await this.contracts.serviceRegistry.services(
              this.indexerAddress,
            )
            if (service.url === this.indexerConfigs.url && service.geohash === geoHash) {
              if (await this.transactionManager.isOperator.value()) {
                logger.info(`Indexer already registered, operator status already granted`)
                return
              } else {
                logger.info(`Indexer already registered, operator status not yet granted`)
              }
            }
          }
          const receipt = await this.transactionManager.executeTransaction(
            () =>
              this.contracts.serviceRegistry.estimateGas.registerFor(
                this.indexerAddress,
                this.indexerConfigs.url,
                geoHash,
              ),
            (gasLimit) =>
              this.contracts.serviceRegistry.registerFor(
                this.indexerAddress,
                this.indexerConfigs.url,
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
      { retries: 5 } as pRetry.Options,
    )
  }

  async claimMany(allocations: Allocation[]): Promise<boolean> {
    const logger = this.logger.child({
      action: 'ClaimMany',
    })
    try {
      logger.info(
        `${allocations.length} allocations are eligible for rebate pool claims`,
        {
          allocations: allocations.map((allocation) => {
            return {
              allocation: allocation.id,
              deployment: allocation.subgraphDeployment.id.display,
              createdAtEpoch: allocation.createdAtEpoch,
              closedAtEpoch: allocation.closedAtEpoch,
              createdAtBlockHash: allocation.createdAtBlockHash,
            }
          }),
          restakeRewards: this.indexerConfigs.restakeRewards,
        },
      )

      // Filter out already-claimed and still-active allocations
      allocations = await pFilter(allocations, async (allocation: Allocation) => {
        // Double-check whether the allocation is claimed to
        // avoid unnecessary transactions.
        // Note: We're checking the allocation state here, which is defined as
        //
        //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
        //
        // in the contracts.
        const state = await this.contracts.staking.getAllocationState(allocation.id)
        if (state === 4) {
          logger.trace(
            `Allocation rebate rewards already claimed, ignoring ${allocation.id}.`,
          )
          return false
        }
        if (state === 1) {
          logger.trace(`Allocation still active, ignoring ${allocation.id}.`)
          return false
        }
        return true
      })

      // Max claims per batch should roughly be equal to average gas per claim / block gas limit
      // On-chain data shows an average of 120k gas per claim and the block gas limit is 15M
      // We get at least 21k gas savings per inclusion of a claim in a batch
      // A reasonable upper bound for this value is 200 assuming the system has the memory
      // requirements to construct the transaction
      const maxClaimsPerBatch = this.indexerConfigs.rebateClaimMaxBatchSize

      // When we construct the batch, we sort desc by query fees collected
      // in order to maximise the value of the truncated batch
      // more query fees collected should mean higher value rebates
      const allocationIds = allocations
        .sort((x, y) =>
          y.queryFeesCollected instanceof BigNumber
            ? y.queryFeesCollected.gt(x.queryFeesCollected || 0)
              ? 1
              : -1
            : -1,
        )
        .map((allocation) => allocation.id)
        .slice(0, maxClaimsPerBatch)

      if (allocationIds.length === 0) {
        logger.info(`No allocation rebates to claim`)
        return true
      } else {
        logger.info(
          `Claim tokens from the rebate pool for ${allocationIds.length} allocations`,
          { allocationIds },
        )
      }

      // Claim the earned value from the rebate pool, returning it to the indexers stake
      const receipt = await this.transactionManager.executeTransaction(
        () =>
          this.contracts.staking.estimateGas.claimMany(
            allocationIds,
            this.indexerConfigs.restakeRewards,
          ),
        (gasLimit) =>
          this.contracts.staking.claimMany(
            allocationIds,
            this.indexerConfigs.restakeRewards,
            {
              gasLimit,
            },
          ),
        logger.child({ function: 'staking.claimMany' }),
      )
      if (receipt === 'paused' || receipt === 'unauthorized') {
        return false
      }
      logger.info(`Successfully claimed ${allocationIds.length} allocations`, {
        claimedAllocations: allocationIds,
      })
      return true
    } catch (err) {
      logger.warn(`Failed to claim allocations`, {
        err: indexerError(IndexerErrorCode.IE016, err),
      })
      return false
    }
  }
}

// TODO: Move to NetworkMonitor
async function monitorNetworkPauses(
  logger: Logger,
  contracts: NetworkContracts,
  networkSubgraph: NetworkSubgraph,
): Promise<Eventual<boolean>> {
  let networkPaused: boolean
  try {
    networkPaused = await contracts.controller.paused()
  } catch (error) {
    logger.error(`Failed to check for network pause with contracts controller`, {
      suberror: IndexerErrorCode.IE007,
      cause: error.message,
    })
    throw indexerError(IndexerErrorCode.IE007, `Failed to check for network pause`)
  }
  return timer(60_000)
    .reduce(async (currentlyPaused) => {
      try {
        const result = await networkSubgraph.query(
          gql`
            {
              graphNetworks {
                isPaused
              }
            }
          `,
        )

        if (result.error) {
          throw result.error
        }

        if (!result.data || result.data.length === 0) {
          throw new Error(`No data returned by network subgraph`)
        }

        return result.data.graphNetworks[0].isPaused
      } catch (err) {
        logger.warn(`Failed to check for network pause, assuming it has not changed`, {
          err: indexerError(IndexerErrorCode.IE007, err),
          paused: currentlyPaused,
        })
        return currentlyPaused
      }
    }, networkPaused)
    .map((paused) => {
      logger.info(paused ? `Network paused` : `Network active`)
      return paused
    })
}

// TODO: Move to NetworkMonitor
async function monitorIsOperator(
  logger: Logger,
  contracts: NetworkContracts,
  indexerAddress: Address,
  wallet: Wallet,
): Promise<Eventual<boolean>> {
  // If indexer and operator address are identical, operator status is
  // implicitly granted => we'll never have to check again
  if (indexerAddress === toAddress(wallet.address)) {
    logger.info(`Indexer and operator are identical, operator status granted`)
    return mutable(true)
  }

  return timer(60_000)
    .reduce(async (isOperator) => {
      try {
        return await contracts.staking.isOperator(wallet.address, indexerAddress)
      } catch (err) {
        logger.warn(
          `Failed to check operator status for indexer, assuming it has not changed`,
          { err: indexerError(IndexerErrorCode.IE008, err), isOperator },
        )
        return isOperator
      }
    }, await contracts.staking.isOperator(wallet.address, indexerAddress))
    .map((isOperator) => {
      logger.info(
        isOperator
          ? `Have operator status for indexer`
          : `No operator status for indexer`,
      )
      return isOperator
    })
}
