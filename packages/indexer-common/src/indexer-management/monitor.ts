import {
  Allocation,
  AllocationStatus,
  Epoch,
  INDEXER_ERROR_MESSAGES,
  indexerError,
  IndexerErrorCode,
  IndexingStatusResolver,
  NetworkSubgraph,
  parseGraphQLAllocation,
  parseGraphQLEpochs,
  parseGraphQLSubgraphDeployment,
  Subgraph,
  SubgraphDeployment,
  SubgraphVersion,
  NetworkEpoch,
  EpochSubgraph,
  BlockPointer,
  resolveChainId,
  resolveChainAlias,
} from '@graphprotocol/indexer-common'
import {
  Address,
  Eventual,
  Logger,
  mutable,
  NetworkContracts,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@tokene-q/common-ts'
import gql from 'graphql-tag'
import { providers, utils, Wallet } from 'ethers'
import pRetry from 'p-retry'

// The new read only Network class
export class NetworkMonitor {
  constructor(
    public networkCAIPID: string,
    private contracts: NetworkContracts,
    private indexer: Address,
    private logger: Logger,
    private indexingStatusResolver: IndexingStatusResolver,
    private networkSubgraph: NetworkSubgraph,
    private ethereum: providers.BaseProvider,
    private epochSubgraph: EpochSubgraph,
  ) {}

  async currentEpochNumber(): Promise<number> {
    return (await this.contracts.epochManager.currentEpoch()).toNumber()
  }

  async maxAllocationEpoch(): Promise<number> {
    return await this.contracts.staking.maxAllocationEpochs()
  }

  async allocation(allocationID: string): Promise<Allocation> {
    const result = await this.networkSubgraph.query(
      gql`
        query allocation($allocation: String!) {
          allocation(id: $allocation) {
            id
            status
            indexer {
              id
            }
            allocatedTokens
            createdAtEpoch
            createdAtBlockHash
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
    return parseGraphQLAllocation(result.data.allocation)
  }

  async allocations(status: AllocationStatus): Promise<Allocation[]> {
    try {
      const result = await this.networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $status: AllocationStatus!) {
            allocations(
              where: { indexer: $indexer, status: $status }
              first: 1000
              orderBy: createdAtBlockNumber
              orderDirection: asc
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
                queryFeesAmount
              }
            }
          }
        `,
        {
          indexer: this.indexer.toLocaleLowerCase(),
          status: status,
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
        this.logger.warn(
          `No ${
            AllocationStatus[status.toUpperCase() as keyof typeof AllocationStatus]
          } allocations found for indexer '${this.indexer}'`,
        )
        return []
      }

      return result.data.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE010, error)
      this.logger.error(`Failed to query indexer allocations`, {
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
                  queryFeesAmount
                }
              }
            }
          }
        `,
        {
          indexer: this.indexer.toLocaleLowerCase(),
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
                  queryFeesAmount
                }
              }
            }
          }
        `,
        {
          indexer: this.indexer.toLocaleLowerCase(),
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

  async subgraphDeployment(ipfsHash: string): Promise<SubgraphDeployment | undefined> {
    try {
      const result = await this.networkSubgraph.query(
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

      // TODO: Make and use parseGraphqlDeployment() function
      return parseGraphQLSubgraphDeployment(result.data.subgraphDeployments[0])
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

  async subgraphDeployments(): Promise<SubgraphDeployment[]> {
    const deployments = []
    const queryProgress = {
      lastId: '',
      first: 10,
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
        deployments.push(...networkDeployments.map(parseGraphQLSubgraphDeployment))
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
      const result = await this.epochSubgraph!.query(
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
            _meta {
              block {
                number
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
        startBlockHash = (await this.ethereum.getBlock(+validBlock.blockNumber)).hash
      } else {
        startBlockHash = await this.indexingStatusResolver.blockHashFromNumber(
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
      } as pRetry.Options)
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

  async fetchPOIBlockPointer(allocation: Allocation): Promise<BlockPointer> {
    try {
      const deploymentIndexingStatuses = await this.indexingStatusResolver.indexingStatus(
        [allocation.subgraphDeployment.id],
      )
      if (
        deploymentIndexingStatuses.length != 1 ||
        deploymentIndexingStatuses[0].chains.length != 1 ||
        !deploymentIndexingStatuses[0].chains[0].network
      ) {
        this.logger.error(
          `No indexing status data found for ${allocation.subgraphDeployment.id.ipfsHash}`,
        )
        throw indexerError(
          IndexerErrorCode.IE018,
          `No indexing status data found for ${allocation.subgraphDeployment.id.ipfsHash}`,
        )
      }
      const deploymentNetworkAlias = deploymentIndexingStatuses[0].chains[0].network
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
    force: boolean,
  ): Promise<string> {
    // poi = undefined, force=true  -- submit even if poi is 0x0
    // poi = defined,   force=true  -- no generatedPOI needed, just submit the POI supplied (with some sanitation?)
    // poi = undefined, force=false -- submit with generated POI if one available
    // poi = defined,   force=false -- submit user defined POI only if generated POI matches
    switch (force) {
      case true:
        switch (!!poi) {
          case true:
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return poi!
          case false:
            return (
              (await this.indexingStatusResolver.proofOfIndexing(
                allocation.subgraphDeployment.id,
                await this.fetchPOIBlockPointer(allocation),
                allocation.indexer,
              )) || utils.hexlify(Array(32).fill(0))
            )
        }
        break
      case false: {
        const epochStartBlock = await this.fetchPOIBlockPointer(allocation)
        // Obtain the start block of the current epoch
        const generatedPOI = await this.indexingStatusResolver.proofOfIndexing(
          allocation.subgraphDeployment.id,
          epochStartBlock,
          allocation.indexer,
        )
        switch (poi == generatedPOI) {
          case true:
            if (poi == undefined) {
              const deploymentStatus = await this.indexingStatusResolver.indexingStatus([
                allocation.subgraphDeployment.id,
              ])
              throw indexerError(
                IndexerErrorCode.IE067,
                `POI not available for deployment at current epoch start block.
              currentEpochStartBlock: ${epochStartBlock.number}
              deploymentStatus: ${
                deploymentStatus.length > 0
                  ? JSON.stringify(deploymentStatus)
                  : 'not deployed'
              }`,
              )
            } else {
              return poi
            }
          case false:
            if (poi == undefined && generatedPOI !== undefined) {
              return generatedPOI
            } else if (poi !== undefined && generatedPOI == undefined) {
              return poi
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

  async monitorNetworkPauses(
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
      }, await contracts.controller.paused())
      .map((paused) => {
        logger.info(paused ? `Network paused` : `Network active`)
        return paused
      })
  }

  async monitorIsOperator(
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
}
