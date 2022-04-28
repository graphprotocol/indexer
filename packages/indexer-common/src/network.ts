import {
  Address,
  Eventual,
  formatGRT,
  Logger,
  mutable,
  NetworkContracts,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationStatus,
  Epoch,
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  INDEXING_RULE_GLOBAL,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  NetworkSubgraph,
  parseGraphQLAllocation,
  parseGraphQLEpochs,
  Subgraph,
  SubgraphIdentifierType,
  SubgraphVersion,
  TransactionManager,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import { BigNumber, providers, utils, Wallet } from 'ethers'
import { strict as assert } from 'assert'
import gql from 'graphql-tag'
import geohash from 'ngeohash'
import pFilter from 'p-filter'
import pRetry from 'p-retry'
import { allocationIdProof } from './allocations/keys'

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

  async subgraphs(ids: string[]): Promise<Subgraph[]> {
    if (ids.length == 0) {
      return []
    }
    let subgraphs: Subgraph[] = []
    const queryProgress = {
      lastId: '',
      first: 20,
      fetched: 0,
      exhausted: false,
      retriesRemaining: 10,
    }
    this.logger.info(`Query subgraphs in batches of ${queryProgress.first}`)

    while (!queryProgress.exhausted) {
      this.logger.debug(`Query subgraphs by id`, {
        queryProgress: queryProgress,
        subgraphIds: ids,
      })
      try {
        const result = await this.networkSubgraph.query(
          gql`
            query subgraphs($first: Int!, $lastId: String!, $subgraphs: [String!]!) {
              subgraphs(
                where: { id_gt: $lastId, id_in: $subgraphs }
                orderBy: id
                orderDirection: asc
                first: $first
              ) {
                id
                versionCount
                versions {
                  version
                  createdAt
                  subgraphDeployment {
                    id
                  }
                }
              }
            }
          `,
          {
            first: queryProgress.first,
            lastId: queryProgress.lastId,
            subgraphs: ids,
          },
        )

        if (result.error) {
          throw result.error
        }

        // Convert return object to Subgraph interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = result.data.subgraphs.map((subgraph: any) => {
          subgraph.versions = subgraph.versions.map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (versionItem: any) => {
              return {
                version: versionItem.version,
                createdAt: versionItem.createdAt,
                deployment: new SubgraphDeploymentID(versionItem.subgraphDeployment.id),
              } as SubgraphVersion
            },
          )
          return subgraph
        })

        // In the case of a fresh graph network there will be no published subgraphs, handle gracefully
        if (results.length == 0 && queryProgress.fetched == 0) {
          this.logger.warn('No subgraph deployments found matching provided ids', {
            retriesRemaining: queryProgress.retriesRemaining,
            subgraphIds: ids,
          })
          throw new Error(`No subgraph deployments found matching provided ids: ${ids}`)
        }

        queryProgress.exhausted = results.length < queryProgress.first
        queryProgress.fetched += results.length
        queryProgress.lastId = results[results.length - 1].id

        subgraphs = subgraphs.concat(results)
      } catch (error) {
        queryProgress.retriesRemaining--
        this.logger.error(`Failed to query subgraphs by id`, {
          retriesRemaining: queryProgress.retriesRemaining,
          error: error,
        })
        if (queryProgress.retriesRemaining <= 0) {
          const err = indexerError(IndexerErrorCode.IE009, error)
          this.logger.error(`Failed to query subgraphs`, {
            err,
          })
          throw err
        }
      }
    }
    this.logger.debug(`Found ${subgraphs.length} matching subgraphs`, {
      subgraphs,
    })
    return subgraphs
  }
  async deploymentsWorthAllocatingTowards(
    rules: IndexingRuleAttributes[],
  ): Promise<SubgraphDeploymentID[]> {
    const globalRule = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)

    const deployments = []
    const queryProgress = {
      lastId: '',
      first: 10,
      fetched: 0,
      exhausted: false,
      retriesRemaining: 10,
    }
    this.logger.info(`Query subgraph deployments in batches of ${queryProgress.first}`)

    while (!queryProgress.exhausted) {
      this.logger.trace(`Query subgraph deployments`, {
        queryProgress: queryProgress,
      })
      try {
        const result = await this.networkSubgraph.query(
          gql`
            query subgraphDeployments($first: Int!, $lastId: String!) {
              subgraphDeployments(
                where: { id_gt: $lastId }
                orderBy: id
                orderDirection: asc
                first: $first
              ) {
                id
                ipfsHash
                deniedAt
                stakedTokens
                signalledTokens
                queryFeesAmount
                indexerAllocations {
                  indexer {
                    id
                  }
                }
              }
            }
          `,
          { first: queryProgress.first, lastId: queryProgress.lastId },
        )

        if (result.error) {
          throw result.error
        }

        const results = result.data.subgraphDeployments

        // In the case of a fresh graph network there will be no published subgraphs, handle gracefully
        if (results.length == 0 && queryProgress.fetched == 0) {
          this.logger.warn('No subgraph deployments returned', {
            retriesRemaining: queryProgress.retriesRemaining,
          })
          throw new Error('No subgraph deployments returned')
        }

        queryProgress.exhausted = results.length < queryProgress.first
        queryProgress.fetched += results.length
        queryProgress.lastId = results[results.length - 1].id
        deployments.push(
          ...results
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((deployment: any) => {
              const deploymentRule =
                rules
                  .filter(
                    (rule) => rule.identifierType == SubgraphIdentifierType.DEPLOYMENT,
                  )
                  .find(
                    (rule) =>
                      new SubgraphDeploymentID(rule.identifier).toString() ===
                      deployment.id,
                  ) || globalRule
              // The deployment is not eligible for deployment if it doesn't have an allocation amount
              if (!deploymentRule?.allocationAmount) {
                this.logger.debug(
                  `Could not find matching rule with non-zero 'allocationAmount':`,
                  {
                    deployment: deployment.display,
                  },
                )
                return false
              }

              if (deploymentRule) {
                const stakedTokens = BigNumber.from(deployment.stakedTokens)
                const signalledTokens = BigNumber.from(deployment.signalledTokens)
                const avgQueryFees = BigNumber.from(deployment.queryFeesAmount).div(
                  BigNumber.from(Math.max(1, deployment.indexerAllocations.length)),
                )

                this.logger.trace('Deciding whether to allocate and index', {
                  deployment: {
                    id: deployment.id.display,
                    deniedAt: deployment.deniedAt,
                    stakedTokens: stakedTokens.toString(),
                    signalledTokens: signalledTokens.toString(),
                    avgQueryFees: avgQueryFees.toString(),
                  },
                  indexingRule: {
                    decisionBasis: deploymentRule.decisionBasis,
                    deployment: deploymentRule.identifier,
                    minStake: deploymentRule.minStake
                      ? BigNumber.from(deploymentRule.minStake).toString()
                      : null,
                    minSignal: deploymentRule.minSignal
                      ? BigNumber.from(deploymentRule.minSignal).toString()
                      : null,
                    maxSignal: deploymentRule.maxSignal
                      ? BigNumber.from(deploymentRule.maxSignal).toString()
                      : null,
                    minAverageQueryFees: deploymentRule.minAverageQueryFees
                      ? BigNumber.from(deploymentRule.minAverageQueryFees).toString()
                      : null,
                    requireSupported: deploymentRule.requireSupported,
                  },
                })

                // Reject unsupported subgraph by default
                if (deployment.deniedAt > 0 && deploymentRule.requireSupported) {
                  return false
                }

                // Skip the indexing rules checks if the decision basis is 'always', 'never', or 'offchain'
                if (deploymentRule?.decisionBasis === IndexingDecisionBasis.ALWAYS) {
                  return true
                } else if (
                  deploymentRule?.decisionBasis === IndexingDecisionBasis.NEVER ||
                  deploymentRule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN
                ) {
                  return false
                }

                return (
                  // stake >= minStake?
                  (deploymentRule.minStake &&
                    stakedTokens.gte(deploymentRule.minStake)) ||
                  // signal >= minSignal && signal <= maxSignal?
                  (deploymentRule.minSignal &&
                    signalledTokens.gte(deploymentRule.minSignal)) ||
                  (deploymentRule.maxSignal &&
                    signalledTokens.lte(deploymentRule.maxSignal)) ||
                  // avgQueryFees >= minAvgQueryFees?
                  (deploymentRule.minAverageQueryFees &&
                    avgQueryFees.gte(deploymentRule.minAverageQueryFees))
                )
              } else {
                return false
              }
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((deployment: any) => new SubgraphDeploymentID(deployment.id)),
        )
      } catch (err) {
        queryProgress.retriesRemaining--
        this.logger.warn(`Failed to query subgraph deployments`, {
          retriesRemaining: queryProgress.retriesRemaining,
          error: err,
        })
        if (queryProgress.retriesRemaining <= 0) {
          const error = indexerError(IndexerErrorCode.IE009, err.message)
          this.logger.error(`Failed to query subgraph deployments worth indexing`, {
            error,
          })
          throw error
        }
      }
    }

    this.logger.debug(`Fetched subgraph deployments published to network`, {
      publishedSubgraphs: queryProgress.fetched,
      worthIndexing: deployments.length,
    })
    return deployments
  }

  async recentlyClosedAllocations(
    currentEpoch: number,
    range: number,
  ): Promise<Allocation[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $closedAtEpochThreshold: Int!) {
            indexer(id: $indexer) {
              allocations: totalAllocations(
                where: {
                  indexer: $indexer
                  status: Closed
                  closedAtEpoch_gte: $closedAtEpochThreshold
                }
                first: 1000
              ) {
                id
                indexer {
                  id
                }
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                createdAtBlockHash
                subgraphDeployment {
                  id
                  stakedTokens
                  signalledTokens
                }
              }
            }
          }
        `,
        {
          indexer: this.indexerAddress.toLocaleLowerCase(),
          closedAtEpochThreshold: currentEpoch - range,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (!result.data) {
        throw new Error(`No data / indexer not found on chain`)
      }

      if (!result.data.indexer) {
        throw new Error(`Indexer not found on chain`)
      }

      return result.data.indexer.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(`Failed to query indexer's recently closed allocations`, {
        err,
      })
      throw err
    }
  }

  async closedAllocations(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<Allocation[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $subgraphDeploymentId: String!) {
            indexer(id: $indexer) {
              allocations: totalAllocations(
                where: {
                  indexer: $indexer
                  status: Closed
                  subgraphDeployment: $subgraphDeploymentId
                }
                first: 5
                orderBy: closedAtBlockNumber
                orderDirection: desc
              ) {
                id
                poi
                indexer {
                  id
                }
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                createdAtBlockHash
                subgraphDeployment {
                  id
                  stakedTokens
                  signalledTokens
                }
              }
            }
          }
        `,
        {
          indexer: this.indexerAddress.toLocaleLowerCase(),
          subgraphDeploymentId: subgraphDeploymentId.display.bytes32,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (!result.data) {
        throw new Error(`No data / indexer not found on chain`)
      }

      if (!result.data.indexer) {
        throw new Error(`Indexer not found on chain`)
      }

      return result.data.indexer.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      this.logger.error(
        `Failed to query indexer's previously closed allocation for the deployment`,
        {
          error,
        },
      )
      throw error
    }
  }

  async allocations(status: AllocationStatus): Promise<Allocation[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $status: AllocationStatus!) {
            allocations(where: { indexer: $indexer, status: $status }, first: 1000) {
              id
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              closedAtEpoch
              createdAtBlockHash
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
              }
            }
          }
        `,
        {
          indexer: this.indexerAddress.toLocaleLowerCase(),
          status: AllocationStatus[status],
        },
      )

      if (result.error) {
        throw result.error
      }

      return result.data.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(`Failed to query indexer allocations`, {
        err,
        status,
      })
      throw err
    }
  }

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

  async disputableAllocations(
    currentEpoch: BigNumber,
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
      const disputableEpoch =
        currentEpoch.toNumber() - this.indexerConfigs.poiDisputableEpochs
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
          epoch.startBlockHash = (await this.ethereum.getBlock(epoch?.startBlock))?.hash
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

  // async resolvePOI(
  //   contracts: NetworkContracts,
  //   transactionManager: TransactionManager,
  //   indexingStatusResolver: IndexingStatusResolver,
  //   allocation: Allocation,
  //   poi: string | undefined,
  //   force: boolean,
  // ): Promise<string> {
  //   // poi = undefined, force=true -- submit even if poi is 0x0
  //   // poi = defined,   force=true ---> no generatedPOI needed, just submit the POI supplied (with some sanitation?)
  //   // poi = undefined, force=false -- submit with generated POI if one available
  //   // poi = defined,   force=false -- submit user defined POI only if generated POI matches
  //   switch (force) {
  //     case true:
  //       switch (!!poi) {
  //         case true:
  //           // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  //           return poi!
  //         case false:
  //           return (
  //             (await indexingStatusResolver.proofOfIndexing(
  //               allocation.subgraphDeployment.id,
  //               await transactionManager.ethereum.getBlock(
  //                 (await contracts.epochManager.currentEpochBlock()).toNumber(),
  //               ),
  //               allocation.indexer,
  //             )) || utils.hexlify(Array(32).fill(0))
  //           )
  //       }
  //       break
  //     case false: {
  //       // Obtain the start block of the current epoch
  //       const epochStartBlockNumber = await contracts.epochManager.currentEpochBlock()
  //       const epochStartBlock = await transactionManager.ethereum.getBlock(
  //         epochStartBlockNumber.toNumber(),
  //       )
  //       const generatedPOI = await indexingStatusResolver.proofOfIndexing(
  //         allocation.subgraphDeployment.id,
  //         epochStartBlock,
  //         allocation.indexer,
  //       )
  //       switch (poi == generatedPOI) {
  //         case true:
  //           if (poi == undefined) {
  //             const deploymentStatus = await indexingStatusResolver.indexingStatus([
  //               allocation.subgraphDeployment.id,
  //             ])
  //             throw new Error(`POI not available for deployment at current epoch start block.
  //             currentEpochStartBlock: ${epochStartBlockNumber}
  //             deploymentStatus: ${deploymentStatus}`)
  //           } else {
  //             return poi
  //           }
  //         case false:
  //           if (poi == undefined && generatedPOI !== undefined) {
  //             return generatedPOI
  //           } else if (poi !== undefined && generatedPOI == undefined) {
  //             return poi
  //           }
  //           throw new Error(`User provided PoKI does not match reference fetched from the graph-node. Use '--force' to bypass this POI accuracy check.
  //             POI: ${poi},
  //             referencePOI: ${generatedPOI}`)
  //       }
  //     }
  //   }
  // }

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
            logger.child({ action: 'register' }),
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

  async allocate(
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    activeAllocations: Allocation[],
  ): Promise<Allocation | undefined> {
    const logger = this.logger.child({ deployment: deployment.display })

    if (amount.lt('0')) {
      logger.warn('Cannot allocate a negative amount of GRT, skipping this allocation', {
        amount: amount.toString(),
      })
      return
    }

    if (amount.eq('0')) {
      logger.warn('Cannot allocate zero GRT, skipping this allocation', {
        amount: amount.toString(),
      })
      return
    }

    try {
      const currentEpoch = await this.contracts.epochManager.currentEpoch()

      logger.info(`Allocate to subgraph deployment`, {
        amountGRT: formatGRT(amount),
        epoch: currentEpoch.toString(),
      })

      // Identify how many GRT the indexer has staked
      const freeStake = await this.contracts.staking.getIndexerCapacity(
        this.indexerAddress,
      )

      // If there isn't enough left for allocating, abort
      if (freeStake.lt(amount)) {
        throw indexerError(
          IndexerErrorCode.IE013,
          new Error(
            `Allocation of ${formatGRT(
              amount,
            )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
              freeStake,
            )} GRT`,
          ),
        )
      }

      logger.debug('Obtain a unique Allocation ID')

      // Obtain a unique allocation ID
      const { allocationSigner, allocationId } = uniqueAllocationID(
        this.transactionManager.wallet.mnemonic.phrase,
        currentEpoch.toNumber(),
        deployment,
        activeAllocations.map((allocation) => allocation.id),
      )

      // Double-check whether the allocationID already exists on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await this.contracts.staking.getAllocationState(allocationId)
      if (state !== 0) {
        logger.debug(`Skipping allocation as it already exists onchain`, {
          indexer: this.indexerAddress,
          allocation: allocationId,
          state,
        })
        return
      }

      logger.info(`Allocate`, {
        indexer: this.indexerAddress,
        amount: formatGRT(amount),
        allocation: allocationId,
      })

      const receipt = await this.transactionManager.executeTransaction(
        async () =>
          this.contracts.staking.estimateGas.allocateFrom(
            this.indexerAddress,
            deployment.bytes32,
            amount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            await allocationIdProof(allocationSigner, this.indexerAddress, allocationId),
          ),
        async (gasLimit) =>
          this.contracts.staking.allocateFrom(
            this.indexerAddress,
            deployment.bytes32,
            amount,
            allocationId,
            utils.hexlify(Array(32).fill(0)),
            await allocationIdProof(allocationSigner, this.indexerAddress, allocationId),
            { gasLimit },
          ),
        logger.child({ action: 'allocate' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        return
      }

      const events = receipt.events || receipt.logs
      const event =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            this.contracts.staking.interface.getEventTopic('AllocationCreated'),
          ),
        )
      if (!event) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation was never mined`),
        )
      }

      const eventInputs = this.contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        event.data,
        event.topics,
      )

      logger.info(`Successfully allocated to subgraph deployment`, {
        amountGRT: formatGRT(eventInputs.tokens),
        allocation: eventInputs.allocationID,
        epoch: eventInputs.epoch.toString(),
      })

      return {
        id: allocationId,
        subgraphDeployment: {
          id: deployment,
          stakedTokens: BigNumber.from(0),
          signalledTokens: BigNumber.from(0),
        },
        allocatedTokens: BigNumber.from(eventInputs.tokens),
        createdAtBlockHash: '0x0',
        createdAtEpoch: eventInputs.epoch,
        closedAtEpoch: 0,
        closedAtBlockHash: '0x0',
        closedAtEpochStartBlockHash: '0x0',
        poi: undefined,
      } as Allocation
    } catch (err) {
      logger.error(`Failed to allocate`, {
        amount: formatGRT(amount),
        err,
      })
    }
  }

  async close(allocation: Allocation, poi: string): Promise<boolean> {
    const logger = this.logger.child({
      allocation: allocation.id,
      deployment: allocation.subgraphDeployment.id.display,
      createdAtEpoch: allocation.createdAtEpoch,
      poi: poi,
      createdAtBlockHash: allocation.createdAtBlockHash,
    })
    try {
      logger.info(`Close allocation`)

      // Double-check whether the allocation is still active on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await this.contracts.staking.getAllocationState(allocation.id)
      if (state !== 1) {
        logger.info(`Allocation has already been closed`)
        return true
      }

      const receipt = await this.transactionManager.executeTransaction(
        () => this.contracts.staking.estimateGas.closeAllocation(allocation.id, poi),
        (gasLimit) =>
          this.contracts.staking.closeAllocation(allocation.id, poi, {
            gasLimit,
          }),
        logger.child({ action: 'close' }),
      )
      if (receipt === 'paused' || receipt === 'unauthorized') {
        return false
      }
      logger.info(`Successfully closed allocation`)
      return true
    } catch (err) {
      logger.warn(`Failed to close allocation`, {
        err: indexerError(IndexerErrorCode.IE015, err),
      })
      return false
    }
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
        .sort((x, y) => (y.queryFeesCollected?.gt(x.queryFeesCollected || 0) ? 1 : -1))
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
        logger.child({ action: 'claimMany' }),
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

  async closeAndAllocate(
    // close fields
    existingAllocation: Allocation,
    poi: string,
    // allocate fields
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    activeAllocations: Allocation[],
  ): Promise<Allocation | undefined> {
    const logger = this.logger.child({
      allocation: existingAllocation.id,
      deployment: existingAllocation.subgraphDeployment.id.display,
      createdAtEpoch: existingAllocation.createdAtEpoch,
      poi: poi,
      createdAtBlockHash: existingAllocation.createdAtBlockHash,
    })
    try {
      // Double-check whether the allocation is still active on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const existingState = await this.contracts.staking.getAllocationState(
        existingAllocation.id,
      )
      if (existingState !== 1) {
        logger.info(`Existing allocation has already been closed`)
        return
      }

      if (amount.lt('0')) {
        logger.warn(
          'Cannot reallocate a negative amount of GRT, skipping this allocation',
          {
            amount: amount.toString(),
          },
        )
        return
      }

      if (amount.eq('0')) {
        logger.warn('Cannot reallocate zero GRT, skipping this allocation', {
          amount: amount.toString(),
        })
        return
      }

      const currentEpoch = await this.contracts.epochManager.currentEpoch()

      logger.info(`Reallocate to subgraph deployment`, {
        existingAllocationAmount: formatGRT(existingAllocation.allocatedTokens),
        newAllocationAmount: formatGRT(amount),
        epoch: currentEpoch.toString(),
      })

      // Identify how many GRT the indexer has staked
      const freeStake = await this.contracts.staking.getIndexerCapacity(
        this.indexerAddress,
      )

      // When reallocating, we will first close the old allocation and free up the GRT in that allocation
      // This GRT will be available in addition to freeStake for the new allocation
      const postCloseFreeStake = freeStake.add(existingAllocation.allocatedTokens)

      // If there isn't enough left for allocating, abort
      if (postCloseFreeStake.lt(amount)) {
        throw indexerError(
          IndexerErrorCode.IE013,
          new Error(
            `Unable to allocate ${formatGRT(
              amount,
            )} GRT: indexer only has a free stake amount of ${formatGRT(
              freeStake,
            )} GRT, plus ${formatGRT(
              existingAllocation.allocatedTokens,
            )} GRT from the existing allocation`,
          ),
        )
      }

      logger.debug('Obtain a unique Allocation ID')

      // Obtain a unique allocation ID
      const { allocationSigner, allocationId: newAllocationId } = uniqueAllocationID(
        this.transactionManager.wallet.mnemonic.phrase,
        currentEpoch.toNumber(),
        deployment,
        activeAllocations.map((allocation) => allocation.id),
      )

      // Double-check whether the allocationID already exists on chain, to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const newAllocationState = await this.contracts.staking.getAllocationState(
        newAllocationId,
      )
      if (newAllocationState !== 0) {
        logger.warn(`Skipping Allocation as it already exists onchain`, {
          indexer: this.indexerAddress,
          allocation: newAllocationId,
          newAllocationState,
        })
        return
      }

      const proof = await allocationIdProof(
        allocationSigner,
        this.indexerAddress,
        newAllocationId,
      )

      logger.info(`Executing reallocate transaction`, {
        indexer: this.indexerAddress,
        amount: formatGRT(amount),
        oldAllocation: existingAllocation.id,
        newAllocation: newAllocationId,
        deployment,
        poi,
        proof,
      })

      const receipt = await this.transactionManager.executeTransaction(
        async () =>
          this.contracts.staking.estimateGas.closeAndAllocate(
            existingAllocation.id,
            poi,
            this.indexerAddress,
            deployment.bytes32,
            amount,
            newAllocationId,
            utils.hexlify(Array(32).fill(0)), // metadata
            proof,
          ),
        async (gasLimit) =>
          this.contracts.staking.closeAndAllocate(
            existingAllocation.id,
            poi,
            this.indexerAddress,
            deployment.bytes32,
            amount,
            newAllocationId,
            utils.hexlify(Array(32).fill(0)), // metadata
            proof,
            { gasLimit },
          ),
        logger.child({ action: 'closeAndAllocate' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        return
      }

      const events = receipt.events || receipt.logs
      const event =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        events.find((event: any) =>
          event.topics.includes(
            this.contracts.staking.interface.getEventTopic('AllocationCreated'),
          ),
        )
      if (!event) {
        throw indexerError(
          IndexerErrorCode.IE014,
          new Error(`Allocation was never mined`),
        )
      }

      const eventInputs = this.contracts.staking.interface.decodeEventLog(
        'AllocationCreated',
        event.data,
        event.topics,
      )

      logger.info(`Successfully reallocated to subgraph deployment`, {
        deployment: deployment.display,
        amountGRT: formatGRT(eventInputs.tokens),
        allocation: eventInputs.allocationID,
        epoch: eventInputs.epoch.toString(),
      })

      return {
        id: newAllocationId,
        subgraphDeployment: {
          id: deployment,
          stakedTokens: BigNumber.from(0),
          signalledTokens: BigNumber.from(0),
        },
        allocatedTokens: BigNumber.from(eventInputs.tokens),
        createdAtBlockHash: receipt.blockHash,
        createdAtEpoch: eventInputs.epoch,
        closedAtEpoch: 0,
        closedAtBlockHash: '0x0',
        closedAtEpochStartBlockHash: '0x0',
        poi: undefined,
      } as Allocation
    } catch (err) {
      logger.error(`Failed to closeAndAllocate`, {
        amount: formatGRT(amount),
        err,
      })
    }
  }

  async claim(allocation: Allocation): Promise<boolean> {
    const logger = this.logger.child({
      allocation: allocation.id,
      deployment: allocation.subgraphDeployment.id.display,
      createdAtEpoch: allocation.createdAtEpoch,
      closedAtEpoch: allocation.closedAtEpoch,
      createdAtBlockHash: allocation.createdAtBlockHash,
      restakeRewards: this.indexerConfigs.restakeRewards,
    })
    try {
      logger.info(`Claim tokens from the rebate pool for allocation`, {
        deployment: allocation.subgraphDeployment.id.display,
        allocation: allocation.id,
        claimAmount: this.indexerConfigs.restakeRewards,
      })

      // Double-check whether the allocation is claimed to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await this.contracts.staking.getAllocationState(allocation.id)
      if (state === 4) {
        logger.trace(`Allocation rebate rewards already claimed`)
        return true
      }
      if (state === 1) {
        logger.info(`Allocation still active`)
        return true
      }

      // Claim the earned value from the rebate pool, returning it to the indexers stake
      const receipt = await this.transactionManager.executeTransaction(
        () =>
          this.contracts.staking.estimateGas.claim(
            allocation.id,
            this.indexerConfigs.restakeRewards,
          ),
        (gasLimit) =>
          this.contracts.staking.claim(
            allocation.id,
            this.indexerConfigs.restakeRewards,
            {
              gasLimit,
            },
          ),
        logger.child({ action: 'claim' }),
      )
      if (receipt === 'paused' || receipt === 'unauthorized') {
        return false
      }
      logger.info(`Successfully claimed allocation`, {
        logs: receipt.logs,
      })
      return true
    } catch (err) {
      logger.warn(`Failed to claim allocation`, {
        err: indexerError(IndexerErrorCode.IE016, err),
      })
      return false
    }
  }
}

async function monitorNetworkPauses(
  logger: Logger,
  contracts: NetworkContracts,
  networkSubgraph: NetworkSubgraph,
): Promise<Eventual<boolean>> {
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
    }, await contracts.controller.paused())
    .map((paused) => {
      logger.info(paused ? `Network paused` : `Network active`)
      return paused
    })
}

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
