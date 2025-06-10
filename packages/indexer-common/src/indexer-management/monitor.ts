/* eslint-disable no-case-declarations */
import {
  Allocation,
  AllocationStatus,
  Epoch,
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  GraphNode,
  parseGraphQLAllocation,
  parseGraphQLEpochs,
  parseGraphQLSubgraphDeployment,
  Subgraph,
  SubgraphDeployment,
  SubgraphVersion,
  NetworkEpoch,
  BlockPointer,
  resolveChainId,
  resolveChainAlias,
  TransferredSubgraphDeployment,
  sequentialTimerReduce,
  HorizonTransitionValue,
  Provision,
  parseGraphQLProvision,
  POIData,
  IndexingStatusCode,
} from '@graphprotocol/indexer-common'
import {
  GraphHorizonContracts,
  SubgraphServiceContracts,
} from '@graphprotocol/toolshed/deployments'
import {
  Address,
  Eventual,
  Logger,
  mutable,
  SubgraphDeploymentID,
  toAddress,
  formatGRT,
} from '@graphprotocol/common-ts'
import { HDNodeWallet, hexlify, Provider, ZeroAddress } from 'ethers'
import gql from 'graphql-tag'
import pRetry, { Options } from 'p-retry'
import { IndexerOptions } from '../network-specification'
import pMap from 'p-map'
import { SubgraphClient } from '../subgraph-client'

// The new read only Network class
export class NetworkMonitor {
  constructor(
    public networkCAIPID: string,
    private contracts: GraphHorizonContracts & SubgraphServiceContracts,
    private indexerOptions: IndexerOptions,
    private logger: Logger,
    private graphNode: GraphNode,
    private networkSubgraph: SubgraphClient,
    private ethereum: Provider,
    private epochSubgraph: SubgraphClient,
  ) { }

  poiDisputeMonitoringEnabled(): boolean {
    return this.indexerOptions.poiDisputeMonitoring
  }

  async currentEpochNumber(): Promise<number> {
    return Number(await this.contracts.EpochManager.currentEpoch())
  }

  // Maximum allocation duration is different for legacy and horizon allocations
  // - Legacy allocations - expiration measured in epochs, determined by maxAllocationEpochs
  // - Horizon allocations - expiration measured in seconds, determined by maxPOIStaleness.
  // To simplify the agent logic, this function converts horizon allocation values, returning epoch values
  // regardless of the allocation type.
  async maxAllocationDuration(): Promise<HorizonTransitionValue> {
    const isHorizon = await this.isHorizon()

    if (isHorizon) {
      // TODO HORIZON: this assumes a block time of 12 seconds which is true for current protocol chain but not always
      const BLOCK_IN_SECONDS = 12n
      const epochLengthInBlocks = await this.contracts.EpochManager.epochLength()
      const epochLengthInSeconds = Number(epochLengthInBlocks * BLOCK_IN_SECONDS)

      // When converting to epochs we give it a bit of leeway since missing the allocation expiration in horizon
      // incurs in a severe penalty (missing out on indexing rewards)
      const horizonDurationInSeconds = Number(
        await this.contracts.SubgraphService.maxPOIStaleness(),
      )
      const horizonDurationInEpochs = Math.max(
        1,
        Math.floor(horizonDurationInSeconds / epochLengthInSeconds) - 1,
      )

      return {
        legacy: 28, // Hardcode to the latest known value. This is required for legacy allos in the transition period.
        horizon: horizonDurationInEpochs,
      }
    } else {
      return {
        legacy: Number(await this.contracts.LegacyStaking.maxAllocationEpochs()),
        horizon: 0,
      }
    }
  }

  /**
   * Returns the amount of free stake for the indexer.
   *
   * The free stake is the amount of tokens that the indexer can use to stake in
   * new allocations.
   *
   * Horizon: It's calculated as the difference between the tokens
   * available in the provision and the tokens already locked allocations.
   *
   * Legacy: It's given by the indexer's stake capacity.
   *
   * @returns The amount of free stake for the indexer.
   */
  async freeStake(): Promise<HorizonTransitionValue<bigint, bigint>> {
    const isHorizon = await this.isHorizon()

    if (isHorizon) {
      const address = this.indexerOptions.address
      const dataService = this.contracts.SubgraphService.target.toString()
      const delegationRatio = await this.contracts.SubgraphService.getDelegationRatio()
      const tokensAvailable = await this.contracts.HorizonStaking.getTokensAvailable(
        address,
        dataService,
        delegationRatio,
      )
      const lockedStake =
        await this.contracts.SubgraphService.allocationProvisionTracker(address)
      const freeStake = tokensAvailable > lockedStake ? tokensAvailable - lockedStake : 0n

      return {
        legacy: 0n, // In horizon new legacy allocations cannot be created so we return 0
        horizon: freeStake,
      }
    } else {
      return {
        legacy: await this.contracts.LegacyStaking.getIndexerCapacity(
          this.indexerOptions.address,
        ),
        horizon: 0n,
      }
    }
  }

  /**
   * Check if the network of the allocation is supported
   *
   * (todo-future: check if present in the epoch subgraph)
   * @param allocation: Allocation to check
   * @returns network `alias` if the network is supported, `null` otherwise
   */
  async allocationNetworkAlias(allocation: Allocation): Promise<string | null> {
    // TODO:
    // resolveChainId will throw an Error when we can't resolve the chainId in
    // the future, let's get this from the epoch subgraph (perhaps at startup)
    // and then resolve it here.
    try {
      const { network: allocationNetworkAlias } = await this.graphNode.subgraphFeatures(
        allocation.subgraphDeployment.id,
      )
      if (null === allocationNetworkAlias) {
        return null
      }

      // TODO: check if the network is present in the epoch subgraph instead of
      // our hardcoded list
      resolveChainId(allocationNetworkAlias)

      return allocationNetworkAlias
    } catch {
      return null
    }
  }

  async allocation(allocationID: string): Promise<Allocation> {
    const result = await this.networkSubgraph.checkedQuery(
      gql`
        query allocation($allocation: String!) {
          allocation(id: $allocation) {
            id
            status
            isLegacy
            indexer {
              id
            }
            allocatedTokens
            createdAt
            createdAtEpoch
            createdAtBlockHash
            closedAt
            closedAtEpoch
            subgraphDeployment {
              id
              ipfsHash
              stakedTokens
              signalledTokens
              queryFeesAmount
            }
          }
        }
      `,
      { allocation: allocationID.toLocaleLowerCase() },
    )
    if (result.error) {
      throw result.error
    }

    if (!result.data.allocation || result.data.length == 0) {
      const errorMessage = `No active allocation with id '${allocationID}' found`
      this.logger.warn(errorMessage)
      throw indexerError(IndexerErrorCode.IE063, errorMessage)
    }
    return parseGraphQLAllocation(result.data.allocation, this.networkCAIPID)
  }

  async allocations(status: AllocationStatus): Promise<Allocation[]> {
    const startTimeMs = Date.now()
    try {
      this.logger.debug(`Fetch ${status} allocations`)
      let dataRemaining = true
      let allocations: Allocation[] = []
      let lastId = ''

      while (dataRemaining) {
        const result = await this.networkSubgraph.checkedQuery(
          gql`
            query allocations(
              $indexer: String!
              $status: AllocationStatus!
              $lastId: String!
            ) {
              allocations(
                where: { indexer: $indexer, status: $status, id_gt: $lastId }
                first: 1000
                orderBy: id
                orderDirection: asc
              ) {
                id
                isLegacy
                indexer {
                  id
                }
                allocatedTokens
                createdAt
                createdAtEpoch
                closedAt
                closedAtEpoch
                createdAtBlockHash
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
            indexer: this.indexerOptions.address.toLocaleLowerCase(),
            status: status,
            lastId,
          },
        )

        if (result.error) {
          throw result.error
        }

        if (
          !result.data.allocations ||
          result.data.length === 0 ||
          result.data.allocations.length === 0
        ) {
          dataRemaining = false
        } else {
          lastId = result.data.allocations.slice(-1)[0].id
          allocations = allocations.concat(
            result.data.allocations.map(parseGraphQLAllocation),
          )
        }
      }

      if (allocations.length === 0) {
        this.logger.warn(
          `No ${AllocationStatus[status.toUpperCase() as keyof typeof AllocationStatus]
          } allocations found for indexer '${this.indexerOptions.address}'`,
        )
      }

      this.logger.debug(
        `Finished fetching ${status} allocations in ${Date.now() - startTimeMs}ms`,
      )
      return allocations
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(`Failed to query indexer allocations`, {
        err,
      })
      throw err
    }
  }

  async provision(indexer: string, dataService: string): Promise<Provision> {
    const result = await this.networkSubgraph.checkedQuery(
      gql`
        query provisions($indexer: String!, $dataService: String!) {
          provisions(where: { indexer: $indexer, dataService: $dataService }) {
            id
            indexer {
              id
            }
            dataService {
              id
            }
            tokensProvisioned
            tokensAllocated
            tokensThawing
            thawingPeriod
            maxVerifierCut
          }
        }
      `,
      { indexer, dataService },
    )
    if (result.error) {
      throw result.error
    }

    if (
      !result.data.provisions ||
      result.data.length == 0 ||
      result.data.provisions.length == 0
    ) {
      const errorMessage = `No provision found for indexer '${indexer}' and data service '${dataService}'`
      this.logger.warn(errorMessage)
      throw indexerError(IndexerErrorCode.IE078, errorMessage)
    }

    if (result.data.provisions.length > 1) {
      const errorMessage = `Multiple provisions found for indexer '${indexer}' and data service '${dataService}'`
      this.logger.warn(errorMessage)
      throw indexerError(IndexerErrorCode.IE081, errorMessage)
    }
    return parseGraphQLProvision(result.data.provisions[0])
  }

  async epochs(epochNumbers: number[]): Promise<Epoch[]> {
    try {
      const result = await this.networkSubgraph.checkedQuery(
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

  async recentlyClosedAllocations(
    currentEpoch: number,
    range: number,
  ): Promise<Allocation[]> {
    try {
      this.logger.debug('Fetch recently closed allocations')
      let dataRemaining = true
      let allocations: Allocation[] = []
      let lastId = ''

      while (dataRemaining) {
        const result = await this.networkSubgraph.checkedQuery(
          gql`
            query allocations(
              $indexer: String!
              $closedAtEpochThreshold: Int!
              $lastId: String!
            ) {
              allocations(
                where: {
                  indexer: $indexer
                  status: Closed
                  closedAtEpoch_gte: $closedAtEpochThreshold
                  id_gt: $lastId
                }
                first: 1000
                orderBy: id
                orderDirection: desc
              ) {
                id
                isLegacy
                indexer {
                  id
                }
                allocatedTokens
                createdAt
                createdAtEpoch
                closedAt
                closedAtEpoch
                createdAtBlockHash
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
            indexer: this.indexerOptions.address.toLocaleLowerCase(),
            closedAtEpochThreshold: currentEpoch - range,
            lastId,
          },
        )

        if (result.error) {
          throw result.error
        }

        if (
          !result.data.allocations ||
          result.data.length === 0 ||
          result.data.allocations.length === 0
        ) {
          dataRemaining = false
        } else {
          lastId = result.data.allocations.slice(-1)[0].id
          allocations = allocations.concat(
            result.data.allocations.map(parseGraphQLAllocation),
          )
        }
      }

      if (allocations.length === 0) {
        this.logger.warn(
          `No recently closed allocations found for indexer '${this.indexerOptions.address}'`,
        )
      }

      return allocations
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
      const result = await this.networkSubgraph.checkedQuery(
        gql`
          query allocations($indexer: String!, $subgraphDeploymentId: String!) {
            allocations(
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
              isLegacy
              poi
              indexer {
                id
              }
              allocatedTokens
              createdAt
              createdAtEpoch
              closedAt
              closedAtEpoch
              createdAtBlockHash
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
          indexer: this.indexerOptions.address.toLocaleLowerCase(),
          subgraphDeploymentId: subgraphDeploymentId.display.bytes32,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (
        !result.data.allocations ||
        result.data.length === 0 ||
        result.data.allocations.length === 0
      ) {
        this.logger.warn('No closed allocations found for deployment', {
          id: subgraphDeploymentId.display.bytes32,
          ipfsHash: subgraphDeploymentId.display,
        })
        return []
      }

      return result.data.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(
        `Failed to query indexer's previously closed allocation for the deployment`,
        {
          err,
        },
      )
      throw err
    }
  }

  async subgraphs(ids: string[]): Promise<Subgraph[]> {
    if (ids.length == 0) {
      return []
    }
    let subgraphs: Subgraph[] = []
    const queryProgress = {
      pageSize: 1000,
      fetched: 0,
      exhausted: false,
      retriesRemaining: 10,
    }
    this.logger.info(`Query subgraphs in batches of ${queryProgress.pageSize}`)
    const groups: string[][] = []
    for (let i = 0; i < ids.length; i += queryProgress.pageSize) {
      groups.push(ids.slice(i, i + queryProgress.pageSize))
    }

    for (const group of groups) {
      this.logger.debug(`Query subgraphs by id`, {
        queryProgress: queryProgress,
        subgraphIds: ids,
      })
      try {
        const result = await this.networkSubgraph.checkedQuery(
          gql`
            query subgraphs($subgraphs: [String!]!) {
              subgraphs(where: { id_in: $subgraphs }, orderBy: id, orderDirection: asc) {
                id
                createdAt
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
            subgraphs: group,
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

        queryProgress.fetched += results.length
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

  async subgraphDeployment(ipfsHash: string): Promise<SubgraphDeployment | undefined> {
    try {
      const result = await this.networkSubgraph.checkedQuery(
        gql`
          query subgraphDeployments($ipfsHash: String!) {
            subgraphDeployments(where: { ipfsHash: $ipfsHash }) {
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
        {
          ipfsHash: ipfsHash,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (
        !result.data ||
        !result.data.subgraphDeployments ||
        result.data.subgraphDeployments.length === 0
      ) {
        this.logger.warn(
          `SubgraphDeployment with ipfsHash = ${ipfsHash} not found on chain`,
        )
        return undefined
      }

      return parseGraphQLSubgraphDeployment(
        result.data.subgraphDeployments[0],
        this.networkCAIPID,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(
        `Failed to query subgraphDeployment with ipfsHash = ${ipfsHash}`,
        {
          err,
        },
      )
      throw err
    }
  }

  async transferredDeployments(): Promise<TransferredSubgraphDeployment[]> {
    this.logger.debug('Querying the Network for transferred subgraph deployments')
    try {
      const result = await this.networkSubgraph.checkedQuery(
        // TODO: Consider querying for the same time range as the Agent's evaluation, limiting
        // results to recent transfers.
        gql`
          {
            subgraphs(
              where: { startedTransferToL2: true }
              orderBy: startedTransferToL2At
              orderDirection: asc
            ) {
              id
              idOnL1
              idOnL2
              startedTransferToL2
              startedTransferToL2At
              startedTransferToL2AtBlockNumber
              startedTransferToL2AtTx
              transferredToL2
              transferredToL2At
              transferredToL2AtBlockNumber
              transferredToL2AtTx
              versions {
                subgraphDeployment {
                  ipfsHash
                }
              }
            }
          }
        `,
      )

      if (result.error) {
        throw result.error
      }

      const transferredDeployments = result.data.subgraphs

      // There may be no transferred subgraphs, handle gracefully
      if (transferredDeployments.length == 0) {
        this.logger.warn(
          'Failed to query subgraph deployments transferred to L2: no deployments found',
        )
        throw new Error('No transferred subgraph deployments returned')
      }

      // Flatten multiple subgraphDeployment versions into a single `TransferredSubgraphDeployment` object
      // TODO: We could use `zod` to parse GraphQL responses into the expected type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return transferredDeployments.flatMap((deployment: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return deployment.versions.map((version: any) => {
          return {
            id: deployment.id,
            idOnL1: deployment.idOnL1,
            idOnL2: deployment.idOnL2,
            startedTransferToL2: deployment.startedTransferToL2,
            startedTransferToL2At: BigInt(deployment.startedTransferToL2At),
            startedTransferToL2AtBlockNumber: BigInt(
              deployment.startedTransferToL2AtBlockNumber,
            ),
            startedTransferToL2AtTx: deployment.startedTransferToL2AtTx,
            transferredToL2: deployment.transferredToL2,
            transferredToL2At: deployment.transferredToL2At
              ? BigInt(deployment.transferredToL2At)
              : null,
            transferredToL2AtTx: deployment.transferredToL2AtTx,
            transferredToL2AtBlockNumber: deployment.transferredToL2AtBlockNumber
              ? BigInt(deployment.transferredToL2AtBlockNumber)
              : null,
            ipfsHash: version.subgraphDeployment.ipfsHash,
            protocolNetwork: this.networkCAIPID,
            ready: null,
          }
        })
      })
    } catch (err) {
      const error = indexerError(IndexerErrorCode.IE009, err.message)
      this.logger.error(`Failed to query transferred subgraph deployments`, {
        error,
      })
      throw error
    }
  }

  async subgraphDeployments(): Promise<SubgraphDeployment[]> {
    const deployments: SubgraphDeployment[] = []
    const queryProgress = {
      lastId: '',
      first: 1000,
      fetched: 0,
      exhausted: false,
      retriesRemaining: 10,
    }
    this.logger.debug(`Query subgraph deployments in batches of ${queryProgress.first}`)

    while (!queryProgress.exhausted) {
      this.logger.trace(`Query subgraph deployments`, {
        queryProgress: queryProgress,
      })
      try {
        const result = await this.networkSubgraph.checkedQuery(
          gql`
            query subgraphDeployments($first: Int!, $lastId: String!) {
              subgraphDeployments(
                where: { id_gt: $lastId }
                orderBy: id
                orderDirection: asc
                first: $first
              ) {
                createdAt
                id
                ipfsHash
                deniedAt
                stakedTokens
                signalledTokens
                queryFeesAmount
              }
            }
          `,
          { first: queryProgress.first, lastId: queryProgress.lastId },
        )

        if (result.error) {
          throw result.error
        }

        const networkDeployments = result.data.subgraphDeployments

        // In the case of a fresh graph network there will be no published subgraphs, handle gracefully
        if (networkDeployments.length == 0 && queryProgress.fetched == 0) {
          this.logger.warn('Failed to query subgraph deployments: no deployments found', {
            retriesRemaining: queryProgress.retriesRemaining,
          })
          throw new Error('No subgraph deployments returned')
        }

        queryProgress.exhausted = networkDeployments.length < queryProgress.first
        queryProgress.fetched += networkDeployments.length
        queryProgress.lastId = networkDeployments[networkDeployments.length - 1].id
        deployments.push(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...networkDeployments.map((x: any) =>
            parseGraphQLSubgraphDeployment(x, this.networkCAIPID),
          ),
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

    this.logger.debug(`Finished fetching subgraph deployments published to network`, {
      publishedSubgraphs: queryProgress.fetched,
    })
    return deployments
  }

  async networkCurrentEpoch(): Promise<NetworkEpoch> {
    return this.currentEpoch(this.networkCAIPID)
  }

  async currentEpoch(networkID: string): Promise<NetworkEpoch> {
    const networkAlias = resolveChainAlias(networkID)

    const queryEpochSubgraph = async () => {
      // We know it is non-null because of the check above for a null case that will end execution of fn if true
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const result = await this.epochSubgraph!.checkedQuery(
        gql`
          query network($networkID: String!) {
            network(id: $networkID) {
              latestValidBlockNumber {
                network {
                  id
                }
                epochNumber
                blockNumber
                previousBlockNumber {
                  network {
                    id
                  }
                  epochNumber
                  blockNumber
                }
              }
            }
          }
        `,
        {
          networkID,
        },
      )

      if (result.error) {
        throw result.error
      }

      if (!result.data.network) {
        // If the network is missing, it means it is not registered in the Epoch Subgraph.
        throw new Error(
          `Failed to query EBO for ${networkID}'s latest valid epoch number: Network not found`,
        )
      }

      if (!result.data.network.latestValidBlockNumber) {
        // If there is no block number, it means the Epoch Subgraph did not receive the initial
        // update for this network.
        throw new Error(
          `Failed to query EBO for ${networkID}'s latest valid epoch number: Network not yet initialized`,
        )
      }

      // Check for validity with Epoch Manager's currentEpoch method, and fetch block hash after that.
      const epochManagerCurrentEpoch = await this.currentEpochNumber()
      const epochSubgraphCurrentEpoch =
        result.data.network.latestValidBlockNumber.epochNumber

      // The Epoch Manager will always lead new epochs, so the epochSubgraphCurrentEpoch should be subtracted.
      const epochDifference = epochManagerCurrentEpoch - epochSubgraphCurrentEpoch

      const logContext = {
        epochManagerCurrentEpoch,
        epochSubgraphCurrentEpoch,
        epochDifferenceFromContracts: epochDifference,
        networkID,
      }

      if (epochDifference < 0) {
        // Somehow, the Epoch Manager is behind the Epoch Subgraph. This is a critical failure.
        const criticalErrorMessage = `The Epoch Manager is behind the Epoch Subgraph`
        this.logger.critical(criticalErrorMessage, { ...logContext })
        throw new Error(criticalErrorMessage)
      }

      if (epochDifference > 1) {
        // It is not acceptable to submit a POI for an epoch more than one epoch away from the current epoch
        const errorMessage = `The Epoch Subgraph is ${epochDifference} epochs away from the Epoch Manager. \
It should never be more than 1 epoch away from the Epoch Manager contract. \
Please submit an issue at https://github.com/graphprotocol/block-oracle/issues/new`
        this.logger.error(errorMessage, { ...logContext })
        throw new Error(errorMessage)
      }

      if (epochDifference === 1) {
        // It is acceptable that the Epoch Subgraph stays at least one epoch behind the Epoch
        // Manager, considering this measurement could have happened during an epoch transition.
        this.logger.info(`Epoch Subgraph is one epoch behind the Epoch Manager`, {
          ...logContext,
        })
      }

      // At this point, the epoch difference is either 0 or 1.
      const validBlock = result.data.network.latestValidBlockNumber

      // Resolve block hash for the given block number.
      // Calls the configured provider for blocks from protocol chain, or Graph Node otherwise.
      let startBlockHash: string
      if (networkID == this.networkCAIPID) {
        const block = await this.ethereum.getBlock(+validBlock.blockNumber)
        startBlockHash = block!.hash!
      } else {
        startBlockHash = await this.graphNode.blockHashFromNumber(
          networkAlias,
          +validBlock.blockNumber,
        )
      }

      const latestBlock = result.data._meta.block.number

      this.logger.info('Resolved current Epoch', { latestBlock, ...logContext })

      return {
        networkID,
        epochNumber: +validBlock.epochNumber,
        startBlockNumber: +validBlock.blockNumber,
        startBlockHash,
        latestBlock,
      }
    }

    try {
      return await pRetry(queryEpochSubgraph, {
        retries: 5,
        maxTimeout: 10000,
        onFailedAttempt: (err) => {
          this.logger.warn(`Epoch subgraph could not be queried`, {
            networkID,
            networkAlias,
            attempt: err.attemptNumber,
            retriesLeft: err.retriesLeft,
            err: err.message,
          })
        },
      } as Options)
    } catch (err) {
      if (err instanceof indexerError) {
        throw err
      } else {
        this.logger.error(`Failed to query latest epoch number`, {
          err,
          msg: err.message,
          networkID,
          networkAlias,
        })
        throw indexerError(IndexerErrorCode.IE069, err)
      }
    }
  }

  async fetchPOIBlockPointer(
    deploymentNetworkAlias: string,
    allocation: Allocation,
  ): Promise<BlockPointer> {
    try {
      const deploymentNetworkCAIPID = resolveChainId(deploymentNetworkAlias)
      const currentEpoch = await this.currentEpoch(deploymentNetworkCAIPID)

      this.logger.trace(`Fetched block pointer to use in resolving POI`, {
        deployment: allocation.subgraphDeployment.id.ipfsHash,
        deploymentNetworkAlias,
        currentEpochStartBlockNumber: currentEpoch.startBlockNumber,
        currentEpochStartBlockHash: currentEpoch.startBlockHash,
      })
      return {
        number: currentEpoch.startBlockNumber,
        hash: currentEpoch.startBlockHash,
      }
    } catch (error) {
      this.logger.error(`Failed to fetch block for resolving allocation POI`, {
        err: error.cause ?? error.message,
        allocationID: allocation.id,
        deployment: allocation.subgraphDeployment.id.ipfsHash,
      })
      throw error
    }
  }

  async resolvePOI(
    allocation: Allocation,
    poi: string | undefined,
    publicPOI: string | undefined,
    blockNumber: number | undefined,
    force: boolean,
  ): Promise<POIData> {
    const [resolvedPOI, resolvedPOIBlockNumber] = await this._resolvePOI(
      allocation,
      poi,
      force,
    )

    if (allocation.isLegacy) {
      return {
        poi: resolvedPOI,
        publicPOI: hexlify(new Uint8Array(32).fill(0)),
        blockNumber: 0,
        indexingStatus: IndexingStatusCode.Unknown,
      }
    } else {
      const resolvedBlockNumber = await this._resolvePOIBlockNumber(
        blockNumber,
        resolvedPOIBlockNumber,
        force,
      )
      const resolvedPublicPOI = await this._resolvePublicPOI(
        allocation,
        publicPOI,
        resolvedBlockNumber,
        force,
      )
      const resolvedIndexingStatus = await this._resolveIndexingStatus(
        allocation.subgraphDeployment.id,
      )

      return {
        poi: resolvedPOI,
        publicPOI: resolvedPublicPOI,
        blockNumber: resolvedBlockNumber,
        indexingStatus: resolvedIndexingStatus,
      }
    }
  }

  async monitorNetworkPauses(
    logger: Logger,
    contracts: GraphHorizonContracts & SubgraphServiceContracts,
    networkSubgraph: SubgraphClient,
  ): Promise<Eventual<boolean>> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const initialPauseValue = await contracts.Controller.paused().catch((_) => {
      return false
    })
    return sequentialTimerReduce(
      {
        logger,
        milliseconds: 60_000,
      },
      async (currentlyPaused) => {
        try {
          logger.debug('Query network subgraph isPaused state')
          const result = await networkSubgraph.checkedQuery(gql`
            {
              graphNetworks {
                isPaused
              }
            }
          `)

          if (result.error) {
            throw result.error
          }

          if (!result.data || result.data.length === 0) {
            throw indexerError(
              IndexerErrorCode.IE007,
              `No data returned by network subgraph`,
            )
          }

          return result.data.graphNetworks[0].isPaused
        } catch (err) {
          logger.warn(`Failed to check for network pause, assuming it has not changed`, {
            err: indexerError(IndexerErrorCode.IE007, err),
            paused: currentlyPaused,
          })
          return currentlyPaused
        }
      },
      initialPauseValue,
    ).map((paused) => {
      logger.info(paused ? `Network paused` : `Network active`)
      return paused
    })
  }

  async monitorIsOperator(
    logger: Logger,
    indexerAddress: Address,
    wallet: HDNodeWallet,
  ): Promise<Eventual<boolean>> {
    // If indexer and operator address are identical, operator status is
    // implicitly granted => we'll never have to check again
    if (indexerAddress === toAddress(wallet.address)) {
      logger.info(`Indexer and operator are identical, operator status granted`)
      return mutable(true)
    }

    return sequentialTimerReduce(
      {
        logger,
        milliseconds: 300_000,
      },
      async (isOperator) => {
        try {
          logger.debug('Check operator status')
          return await this.isOperator(wallet.address, indexerAddress)
        } catch (err) {
          logger.warn(
            `Failed to check operator status for indexer, assuming it has not changed`,
            { err: indexerError(IndexerErrorCode.IE008, err), isOperator },
          )
          return isOperator
        }
      },
      await this.isOperator(wallet.address, indexerAddress),
    ).map((isOperator) => {
      logger.info(
        isOperator
          ? `Have operator status for indexer`
          : `No operator status for indexer`,
      )
      return isOperator
    })
  }

  async monitorIsHorizon(
    logger: Logger,
    interval: number = 300_000,
  ): Promise<Eventual<boolean>> {
    return sequentialTimerReduce(
      {
        logger,
        milliseconds: interval,
      },
      async (isHorizon) => {
        try {
          logger.debug('Check if network is Horizon ready')
          return await this.isHorizon()
        } catch (err) {
          logger.warn(
            `Failed to check if network is Horizon ready, assuming it has not changed`,
            { err: indexerError(IndexerErrorCode.IE008, err), isHorizon },
          )
          return isHorizon
        }
      },
      await this.isHorizon(),
    ).map((isHorizon) => {
      logger.info(isHorizon ? `Network is Horizon ready` : `Network is not Horizon ready`)
      return isHorizon
    })
  }

  async claimableAllocations(disputableEpoch: number): Promise<Allocation[]> {
    try {
      this.logger.debug('Fetch claimable allocations', {
        closedAtEpoch_lte: disputableEpoch,
        queryFeesCollected_gte: this.indexerOptions.rebateClaimThreshold.toString(),
      })
      const result = await this.networkSubgraph.checkedQuery(
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
              isLegacy
              indexer {
                id
              }
              queryFeesCollected
              allocatedTokens
              createdAt
              createdAtEpoch
              closedAt
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
          indexer: this.indexerOptions.address.toLocaleLowerCase(),
          disputableEpoch,
          minimumQueryFeesCollected: this.indexerOptions.rebateClaimThreshold.toString(),
        },
      )

      if (result.error) {
        throw result.error
      }

      const totalFees: bigint = result.data.allocations.reduce(
        (total: bigint, rawAlloc: { queryFeesCollected: string }) => {
          return total + BigInt(rawAlloc.queryFeesCollected)
        },
        0n,
      )

      const parsedAllocs: Allocation[] =
        result.data.allocations.map(parseGraphQLAllocation)

      // If the total fees claimable do not meet the minimum required for batching, return an empty array
      if (
        parsedAllocs.length > 0 &&
        totalFees < this.indexerOptions.rebateClaimBatchThreshold
      ) {
        this.logger.info(
          `Allocation rebate batch value does not meet minimum for claiming`,
          {
            batchValueGRT: formatGRT(totalFees),
            rebateClaimBatchThreshold: formatGRT(
              this.indexerOptions.rebateClaimBatchThreshold,
            ),
            rebateClaimMaxBatchSize: this.indexerOptions.rebateClaimMaxBatchSize,
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
    currentEpoch: number,
    deployments: SubgraphDeploymentID[],
    minimumAllocation: number,
  ): Promise<Allocation[]> {
    const logger = this.logger.child({ component: 'POI Monitor' })
    if (!this.indexerOptions.poiDisputeMonitoring) {
      logger.trace('POI monitoring disabled, skipping')
      return Promise.resolve([])
    }

    logger.debug('Query network for any potentially disputable allocations')

    let dataRemaining = true
    let allocations: Allocation[] = []

    try {
      const zeroPOI = hexlify(new Uint8Array(32).fill(0))
      const disputableEpoch = currentEpoch - this.indexerOptions.poiDisputableEpochs
      let lastId = ''
      while (dataRemaining) {
        const result = await this.networkSubgraph.checkedQuery(
          gql`
            query allocations(
              $deployments: [String!]!
              $minimumAllocation: Int!
              $disputableEpoch: Int!
              $zeroPOI: String!
              $lastId: String!
            ) {
              allocations(
                where: {
                  id_gt: $lastId
                  subgraphDeployment_in: $deployments
                  allocatedTokens_gt: $minimumAllocation
                  closedAtEpoch_gte: $disputableEpoch
                  status: Closed
                  poi_not: $zeroPOI
                }
                first: 1000
                orderBy: id
                orderDirection: asc
              ) {
                id
                isLegacy
                createdAt
                indexer {
                  id
                }
                poi
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                closedAt
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
            lastId,
            zeroPOI,
          },
        )

        if (result.error) {
          throw result.error
        }
        if (result.data.allocations.length == 0) {
          dataRemaining = false
        } else {
          lastId = result.data.allocations.slice(-1)[0].id
          const parsedResult: Allocation[] =
            result.data.allocations.map(parseGraphQLAllocation)
          allocations = allocations.concat(parsedResult)
        }
      }

      // Get the unique set of dispute epochs to reduce the work fetching epoch start block hashes in the next step
      const disputableEpochs = await this.epochs([
        ...allocations.reduce((epochNumbers: Set<number>, allocation: Allocation) => {
          epochNumbers.add(allocation.closedAtEpoch)
          epochNumbers.add(allocation.closedAtEpoch - 1)
          return epochNumbers
        }, new Set()),
      ])
      const availableEpochs = await pMap(
        disputableEpochs,
        async (epoch) => {
          try {
            const startBlock = await this.ethereum.getBlock(epoch.startBlock)
            epoch.startBlockHash = startBlock!.hash!
          } catch {
            logger.debug('Failed to fetch block hash for startBlock of epoch', {
              epoch: epoch.id,
              startBlock: epoch.startBlock,
            })
          }

          return epoch
        },
        {
          stopOnError: true,
          concurrency: 1,
        },
      )
      availableEpochs.filter((epoch) => !!epoch.startBlockHash)

      return await pMap(
        allocations,
        async (allocation) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          allocation.closedAtEpochStartBlockHash = availableEpochs.find(
            (epoch) => epoch.id == allocation.closedAtEpoch,
          )?.startBlockHash
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          allocation.previousEpochStartBlockHash = availableEpochs.find(
            (epoch) => epoch.id == allocation.closedAtEpoch - 1,
          )?.startBlockHash
          return allocation
        },
        {
          stopOnError: true,
          concurrency: 1,
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE037, error)
      logger.error(INDEXER_ERROR_MESSAGES.IE037, {
        err,
      })
      throw err
    }
  }

  private async isHorizon() {
    try {
      const maxThawingPeriod = await this.contracts.HorizonStaking.getMaxThawingPeriod()
      return maxThawingPeriod > 0
    } catch (err) {
      return false
    }
  }

  private async isOperator(operatorAddress: string, indexerAddress: string) {
    if (await this.isHorizon()) {
      return await this.contracts.HorizonStaking.isAuthorized(
        indexerAddress,
        this.contracts.SubgraphService.target,
        operatorAddress,
      )
    } else {
      return await this.contracts.LegacyStaking.isOperator(
        operatorAddress,
        indexerAddress,
      )
    }
  }

  // Returns a tuple of [POI, blockNumber]
  // - POI is the POI to submit, which could be user provider or generated
  // - blockNumber is the block number of the POI. If it's 0 then the block number is not known at this point.
  private async _resolvePOI(
    allocation: Allocation,
    poi: string | undefined,
    force: boolean,
  ): Promise<[string, number]> {
    // If the network is not supported, we can't resolve POI, as there will be no active epoch
    const supportedNetworkAlias = await this.allocationNetworkAlias(allocation)
    if (null === supportedNetworkAlias) {
      this.logger.info("Network is not supported, can't resolve POI")
      return [hexlify(new Uint8Array(32).fill(0)), 0]
    }

    // poi = undefined, force=true  -- submit even if poi is 0x0
    // poi = defined,   force=true  -- no generatedPOI needed, just submit the POI supplied (with some sanitation?)
    // poi = undefined, force=false -- submit with generated POI if one available
    // poi = defined,   force=false -- submit user defined POI only if generated POI matches
    switch (force) {
      case true:
        switch (!!poi) {
          case true:
            this.logger.trace('Resolve POI: Force true, poi defined', {
              poi,
              blockNumber: 0,
            })
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return [poi!, 0]
          case false:
            const poiBlockNumber = await this.fetchPOIBlockPointer(
              supportedNetworkAlias,
              allocation,
            )
            const generatedPOI = await this.graphNode.proofOfIndexing(
              allocation.subgraphDeployment.id,
              poiBlockNumber,
              allocation.indexer,
            )
            const returnValue: [string, number] =
              generatedPOI !== undefined
                ? [generatedPOI, poiBlockNumber.number]
                : [hexlify(new Uint8Array(32).fill(0)), 0]

            this.logger.trace('Resolve POI: Force true, poi undefined', {
              poi: returnValue[0],
              blockNumber: returnValue[1],
            })
            return returnValue
        }
        break
      case false: {
        const epochStartBlock = await this.fetchPOIBlockPointer(
          supportedNetworkAlias,
          allocation,
        )
        // Obtain the start block of the current epoch
        const generatedPOI = await this.graphNode.proofOfIndexing(
          allocation.subgraphDeployment.id,
          epochStartBlock,
          allocation.indexer,
        )
        switch (poi == generatedPOI) {
          case true:
            this.logger.trace('Resolve POI: Force false, poi matches generated', {
              poi,
              blockNumber: epochStartBlock.number,
            })
            if (poi == undefined) {
              const deploymentStatus = await this.graphNode.indexingStatus([
                allocation.subgraphDeployment.id,
              ])
              throw indexerError(
                IndexerErrorCode.IE067,
                `POI not available for deployment at current epoch start block.
              currentEpochStartBlock: ${epochStartBlock.number}
              deploymentStatus: ${deploymentStatus.length > 0
                  ? JSON.stringify(deploymentStatus)
                  : 'not deployed'
                }`,
              )
            } else {
              return [poi, epochStartBlock.number]
            }
          case false:
            this.logger.trace('Resolve POI: Force false, poi does not match generated', {
              poi,
              generatedPOI,
              blockNumber: epochStartBlock.number,
            })
            if (poi == undefined && generatedPOI !== undefined) {
              return [generatedPOI, epochStartBlock.number]
            } else if (poi !== undefined && generatedPOI == undefined) {
              return [poi, 0]
            }
            throw indexerError(
              IndexerErrorCode.IE068,
              `User provided POI does not match reference fetched from the graph-node. Use '--force' to bypass this POI accuracy check.
              POI: ${poi},
              referencePOI: ${generatedPOI}`,
            )
        }
      }
    }
  }

  private async _resolvePOIBlockNumber(
    blockNumber: number | undefined,
    generatedPOIBlockNumber: number,
    force: boolean,
  ): Promise<number> {
    let returnBlockNumber = 0
    if (generatedPOIBlockNumber === 0) {
      if (blockNumber === undefined) {
        throw indexerError(IndexerErrorCode.IE084, 'No block number generated and none provided')
      }
      returnBlockNumber = blockNumber
    } else if (blockNumber === undefined || generatedPOIBlockNumber === blockNumber) {
      returnBlockNumber = generatedPOIBlockNumber
    } else {
      returnBlockNumber = force ? blockNumber : generatedPOIBlockNumber
    }

    this.logger.trace('Resolve POI block number:', {
      blockNumber,
      generatedPOIBlockNumber,
      returnBlockNumber,
      force,
    })

    return returnBlockNumber
  }

  private async _resolvePublicPOI(
    allocation: Allocation,
    publicPOI: string | undefined,
    blockNumber: number,
    force: boolean,
  ): Promise<string> {
    const blockHash = await this.graphNode.blockHashFromNumber(
      resolveChainAlias(this.networkCAIPID),
      blockNumber,
    )
    const generatedPublicPOI = await this.graphNode.proofOfIndexing(
      allocation.subgraphDeployment.id,
      {
        number: blockNumber,
        hash: blockHash,
      },
      ZeroAddress,
    )

    let returnPublicPOI: string
    if (generatedPublicPOI === undefined) {
      if (publicPOI === undefined) {
        throw indexerError(IndexerErrorCode.IE085, 'No public POI generated and none provided')
      }
      returnPublicPOI = publicPOI
    } else if (publicPOI === undefined || generatedPublicPOI === publicPOI) {
      returnPublicPOI = generatedPublicPOI
    } else {
      returnPublicPOI = force ? publicPOI : generatedPublicPOI
    }

    this.logger.trace('Resolve public POI:', {
      blockNumber,
      publicPOI,
      generatedPublicPOI,
      returnPublicPOI,
      force,
    })

    return returnPublicPOI
  }

  private async _resolveIndexingStatus(
    deployment: SubgraphDeploymentID,
  ): Promise<IndexingStatusCode> {
    const indexingStatus = await this.graphNode.indexingStatus([deployment])

    let indexingStatusCode = IndexingStatusCode.Unknown
    if (indexingStatus.length === 1) {
      switch (indexingStatus[0].health) {
        case 'healthy':
          indexingStatusCode = IndexingStatusCode.Healthy
          break
        case 'unhealthy':
          indexingStatusCode = IndexingStatusCode.Unhealthy
          break
        case 'failed':
          indexingStatusCode = IndexingStatusCode.Failed
          break
        default:
          indexingStatusCode = IndexingStatusCode.Unknown
          break
      }
    }
    return indexingStatusCode
  }
}
