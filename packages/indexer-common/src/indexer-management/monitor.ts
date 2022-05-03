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
} from '@graphprotocol/common-ts'
import gql from 'graphql-tag'
import { providers, utils, Wallet } from 'ethers'

// The new read only Network class
export class NetworkMonitor {
  constructor(
    private contracts: NetworkContracts,
    private indexer: Address,
    private logger: Logger,
    private indexingStatusResolver: IndexingStatusResolver,
    private networkSubgraph: NetworkSubgraph,
    private ethereum: providers.BaseProvider,
  ) {}

  async allocation(allocationID: string): Promise<Allocation | undefined> {
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
      this.logger.warn(`No active allocation with id '${allocationID}' found`)
      return undefined
    }
    return parseGraphQLAllocation(result.data.allocation)
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
      this.logger.error(
        `Failed to query indexer's previously closed allocation for the deployment`,
        {
          error,
        },
      )
      throw error
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
        `Failed to query subgraphDeployment with with ipfsHash = ${ipfsHash}`,
        {
          err,
        },
      )
      throw err
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
                await this.ethereum.getBlock(
                  (await this.contracts.epochManager.currentEpochBlock()).toNumber(),
                ),
                allocation.indexer,
              )) || utils.hexlify(Array(32).fill(0))
            )
        }
        break
      case false: {
        // Obtain the start block of the current epoch
        const epochStartBlockNumber =
          await this.contracts.epochManager.currentEpochBlock()
        const epochStartBlock = await this.ethereum.getBlock(
          epochStartBlockNumber.toNumber(),
        )
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
              throw new Error(`POI not available for deployment at current epoch start block. ß
              currentEpochStartBlock: ${epochStartBlockNumber}
              deploymentStatus: ${
                deploymentStatus.length > 0
                  ? JSON.stringify(deploymentStatus)
                  : 'not deployed'
              }`)
            } else {
              return poi
            }
          case false:
            if (poi == undefined && generatedPOI !== undefined) {
              return generatedPOI
            } else if (poi !== undefined && generatedPOI == undefined) {
              return poi
            }
            throw new Error(`User provided POI does not match reference fetched from the graph-node. Use '--force' to bypass this POI accuracy check. 
              POI: ${poi}, 
              referencePOI: ${generatedPOI}`)
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
