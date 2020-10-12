import {
  Logger,
  NetworkContracts,
  connectContracts,
  SubgraphDeploymentID,
  formatGRT,
  parseGRT,
  timer,
  Eventual,
} from '@graphprotocol/common-ts'
import {
  Allocation,
  AllocationStatus,
  IndexingRuleAttributes,
  IndexingDecisionBasis,
  INDEXING_RULE_GLOBAL,
  parseGraphQLAllocation,
  uniqueAllocationID,
} from '@graphprotocol/indexer-common'
import {
  ContractTransaction,
  ContractReceipt,
  BigNumber,
  providers,
  Wallet,
  utils,
} from 'ethers'
import { strict as assert } from 'assert'
import { Client, createClient } from '@urql/core'
import gql from 'graphql-tag'
import fetch from 'isomorphic-fetch'
import geohash from 'ngeohash'

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: Logger,
    paused: Eventual<boolean>,
  ): Promise<ContractReceipt | 'paused'> {
    if (await paused.value()) {
      logger.info(`Network is paused, skipping this action`)
      return 'paused'
    } else {
      const tx = await transaction
      logger.info(`Transaction pending`, { tx: tx.hash })
      const receipt = await tx.wait(1)
      logger.info(`Transaction successfully included in block`, {
        tx: tx.hash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
      })
      return receipt
    }
  }
}

const txOverrides = {
  gasLimit: 1000000,
  gasPrice: utils.parseUnits('25', 'gwei'),
}

export class Network {
  subgraph: Client
  contracts: NetworkContracts
  indexerAddress: string
  indexerUrl: string
  indexerGeoCoordinates: [string, string]
  mnemonic: string
  logger: Logger
  ethereumProvider: providers.JsonRpcProvider
  paused: Eventual<boolean>

  private constructor(
    logger: Logger,
    indexerAddress: string,
    indexerUrl: string,
    geoCoordinates: [string, string],
    contracts: NetworkContracts,
    mnemonic: string,
    subgraph: Client,
    ethereumProvider: providers.JsonRpcProvider,
  ) {
    this.logger = logger
    this.indexerAddress = indexerAddress
    this.indexerUrl = indexerUrl
    this.indexerGeoCoordinates = geoCoordinates
    this.contracts = contracts
    this.mnemonic = mnemonic
    this.subgraph = subgraph
    this.ethereumProvider = ethereumProvider
    this.paused = this.monitorNetworkPauses()
  }

  monitorNetworkPauses(): Eventual<boolean> {
    return timer(10000)
      .reduce(async currentlyPaused => {
        try {
          const result = await this.subgraph
            .query(
              gql`
                {
                  graphNetworks {
                    isPaused
                  }
                }
              `,
            )
            .toPromise()

          if (result.error) {
            throw result.error
          }

          if (!result.data || result.data.length === 0) {
            throw new Error(`No data returned by network subgraph`)
          }

          return result.data.graphNetworks[0].isPaused
        } catch (error) {
          this.logger.warn(
            `Failed to check for network pause, assuming it has not changed`,
            { error: error.message || error, paused: currentlyPaused },
          )
          return currentlyPaused
        }
      }, false)
      .map(paused => {
        this.logger.info(paused ? `Network paused` : `Network resumed`)
        return paused
      })
  }

  static async create(
    parentLogger: Logger,
    ethereumProviderUrl: string,
    indexerUrl: string,
    indexerQueryEndpoint: string,
    geoCoordinates: [string, string],
    mnemonic: string,
    networkSubgraph: Client | SubgraphDeploymentID,
  ): Promise<Network> {
    const logger = parentLogger.child({ component: 'Network' })

    const subgraph =
      networkSubgraph instanceof Client
        ? networkSubgraph
        : createClient({
            url: new URL(
              `/subgraphs/id/${networkSubgraph.ipfsHash}`,
              indexerQueryEndpoint,
            ).toString(),
            fetch,
          })

    let providerUrl
    try {
      providerUrl = new URL(ethereumProviderUrl)
    } catch (e) {
      throw new Error(`Invalid Ethereum URL '${ethereumProviderUrl}': ${e}`)
    }

    const ethereumProvider = new providers.JsonRpcProvider({
      url: providerUrl.toString(),
      user: providerUrl.username,
      password: providerUrl.password,
    })
    const network = await ethereumProvider.getNetwork()

    logger.info(`Create wallet`, {
      network: network.name,
      chainId: network.chainId,
      provider: ethereumProviderUrl,
    })
    let wallet = Wallet.fromMnemonic(mnemonic)
    wallet = wallet.connect(ethereumProvider)
    logger.info(`Successfully created wallet`, { address: wallet.address })

    logger.info(`Connecting to contracts`)
    const contracts = await connectContracts(wallet, network.chainId)

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

    return new Network(
      logger,
      wallet.address,
      indexerUrl,
      geoCoordinates,
      contracts,
      mnemonic,
      subgraph,
      ethereumProvider,
    )
  }

  async subgraphDeploymentsWorthIndexing(
    rules: IndexingRuleAttributes[],
  ): Promise<SubgraphDeploymentID[]> {
    const globalRule = rules.find(
      rule => rule.deployment === INDEXING_RULE_GLOBAL,
    )

    try {
      // TODO: Paginate here to not miss any deployments
      const result = await this.subgraph
        .query(
          gql`
            query {
              subgraphDeployments {
                id
                stakedTokens
                signalAmount
                signalledTokens
                indexingRewardAmount
                queryFeesAmount
                indexerAllocations {
                  indexer {
                    id
                  }
                  allocatedTokens
                  queryFeesCollected
                }
              }
            }
          `,
          undefined,
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return (
        result.data.subgraphDeployments
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((deployment: any) => {
            const deploymentRule =
              rules.find(rule => rule.deployment === deployment.id) ||
              globalRule

            // The deployment is not eligible for deployment if it doesn't have an allocation amount
            if (!deploymentRule?.allocationAmount) {
              this.logger.debug(
                `Could not find matching rule with non-null 'allocation':`,
                {
                  deployment: deployment.display,
                },
              )
              return false
            }
            // Skip the indexing rules checks if the decision basis is 'always' or 'never'
            if (
              deploymentRule?.decisionBasis === IndexingDecisionBasis.ALWAYS
            ) {
              return true
            } else if (
              deploymentRule?.decisionBasis === IndexingDecisionBasis.NEVER
            ) {
              return false
            }

            if (deploymentRule) {
              const stakedTokens = BigNumber.from(deployment.stakedTokens)
              const signalAmount = BigNumber.from(deployment.signalAmount)
              const avgQueryFees = BigNumber.from(
                deployment.queryFeesAmount,
              ).div(
                BigNumber.from(
                  Math.max(1, deployment.indexerAllocations.length),
                ),
              )

              this.logger.trace('Deciding whether to allocate and index', {
                deployment: {
                  id: deployment.id.display,
                  stakedTokens: stakedTokens.toString(),
                  signalAmount: signalAmount.toString(),
                  avgQueryFees: avgQueryFees.toString(),
                },
                indexingRule: {
                  deployment: deploymentRule.deployment,
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
                    ? BigNumber.from(
                        deploymentRule.minAverageQueryFees,
                      ).toString()
                    : null,
                },
              })

              return (
                // stake >= minStake?
                (deploymentRule.minStake &&
                  stakedTokens.gte(deploymentRule.minStake)) ||
                // signal >= minSignal && signal <= maxSignal?
                (deploymentRule.minSignal &&
                  signalAmount.gte(deploymentRule.minSignal)) ||
                (deploymentRule.maxSignal &&
                  signalAmount.lte(deploymentRule.maxSignal)) ||
                // avgQueryFees >= minAvgQueryFees?
                (deploymentRule.minAverageQueryFees &&
                  avgQueryFees.gte(deploymentRule.minAverageQueryFees))
              )
            } else {
              return false
            }
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((deployment: any) => new SubgraphDeploymentID(deployment.id))
      )
    } catch (error) {
      this.logger.error(`Failed to query subgraphs on the network`, {
        error: error.message,
      })
      throw error
    }
  }

  async allocations(status: AllocationStatus): Promise<Allocation[]> {
    try {
      const result = await this.subgraph
        .query(
          gql`
            query allocations($indexer: String!, $status: AllocationStatus!) {
              allocations(where: { indexer: $indexer, status: $status }) {
                id
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                createdAtBlockHash
                subgraphDeployment {
                  id
                  stakedTokens
                  signalAmount
                }
              }
            }
          `,
          {
            indexer: this.indexerAddress.toLocaleLowerCase(),
            status: AllocationStatus[status],
          },
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.allocations.map(parseGraphQLAllocation)
    } catch (error) {
      this.logger.error(`Failed to query indexer allocations `)
      throw error
    }
  }

  async claimableAllocations(disputableEpoch: number): Promise<Allocation[]> {
    try {
      const result = await this.subgraph
        .query(
          gql`
            query allocations($indexer: String!, $disputableEpoch: Int!) {
              allocations(
                where: {
                  indexer: $indexer
                  closedAtEpoch_lte: $disputableEpoch
                  status: Closed
                }
              ) {
                id
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                createdAtBlockHash
                subgraphDeployment {
                  id
                  stakedTokens
                  signalAmount
                }
              }
            }
          `,
          {
            indexer: this.indexerAddress.toLocaleLowerCase(),
            disputableEpoch,
          },
          { requestPolicy: 'network-only' },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.allocations.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (allocation: any) => ({
          id: allocation.id,
          subgraphDeployment: {
            id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
            stakedTokens: BigNumber.from(
              allocation.subgraphDeployment.stakedTokens,
            ),
            signalAmount: BigNumber.from(
              allocation.subgraphDeployment.signalAmount,
            ),
          },
          allocatedTokens: BigNumber.from(allocation.allocatedTokens),
          createdAtEpoch: allocation.createdAtEpoch,
          createdAtBlockHash: allocation.createdAtBlockHash,
          closedAtEpoch: allocation.closedAtEpoch,
        }),
      )
    } catch (error) {
      this.logger.error(`Failed to query indexer allocations `)
      throw error
    }
  }

  async register(): Promise<void> {
    const geoHash = geohash.encode(
      +this.indexerGeoCoordinates[0],
      +this.indexerGeoCoordinates[1],
    )

    const logger = this.logger.child({
      address: this.indexerAddress,
      url: this.indexerUrl,
      geoCoordinates: this.indexerGeoCoordinates,
      geoHash,
    })

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
        if (service.url === this.indexerUrl && service.geohash === geoHash) {
          logger.info(`Indexer already registered`)
          return
        }
      }

      const receipt = await Ethereum.executeTransaction(
        this.contracts.serviceRegistry.registerFor(
          this.indexerAddress,
          this.indexerUrl,
          geoHash,
          txOverrides,
        ),
        logger.child({ action: 'register' }),
        this.paused,
      )
      if (receipt === 'paused') {
        return
      }
      const event = receipt.events?.find(event =>
        event.topics.includes(
          this.contracts.serviceRegistry.interface.getEventTopic(
            'ServiceRegistered',
          ),
        ),
      )
      assert.ok(event)

      logger.info(`Successfully registered indexer`)
    } catch (error) {
      logger.error(`Failed to register indexer`, {
        error: error.message || error,
      })
      throw error
    }
  }

  async allocate(
    deployment: SubgraphDeploymentID,
    amount: BigNumber,
    activeAllocations: Allocation[],
  ): Promise<void> {
    const price = parseGRT('0.01')

    const logger = this.logger.child({ deployment: deployment.display })

    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    logger.info(`Allocate to subgraph deployment`, {
      amountGRT: formatGRT(amount),
      epoch: currentEpoch.toString(),
    })

    // Identify how many GRT the indexer has staked
    const stakes = await this.contracts.staking.stakes(this.indexerAddress)
    const freeStake = stakes.tokensStaked
      .sub(stakes.tokensAllocated)
      .sub(stakes.tokensLocked)

    // If there isn't enough left for allocating, abort
    if (freeStake.lt(amount)) {
      throw new Error(
        `Failed to allocate ${formatGRT(
          amount,
        )} GRT to '${deployment}': indexer only has ${formatGRT(
          freeStake,
        )} GRT stake free for allocating`,
      )
    }

    // Obtain a unique allocation ID
    const id = uniqueAllocationID(
      this.mnemonic,
      currentEpoch.toNumber(),
      deployment,
      activeAllocations.map(allocation => allocation.id),
    )

    logger.info(`Allocate`, {
      indexer: this.indexerAddress,
      amount: formatGRT(amount),
      allocationId: id,
      price,
      txOverrides,
    })

    const receipt = await Ethereum.executeTransaction(
      this.contracts.staking.allocateFrom(
        this.indexerAddress,
        deployment.bytes32,
        amount,
        id,
        utils.hexlify(Array(32).fill(0)),
        txOverrides,
      ),
      logger.child({ action: 'allocate' }),
      this.paused,
    )

    if (receipt === 'paused') {
      return
    }

    const event = receipt.events?.find(event =>
      event.topics.includes(
        this.contracts.staking.interface.getEventTopic('AllocationCreated'),
      ),
    )

    if (!event) {
      throw new Error(
        `Failed to allocate ${formatGRT(
          amount,
        )} GRT to '${deployment}': allocation was never created`,
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
      const state = await this.contracts.staking.getAllocationState(
        allocation.id,
      )
      if (state !== 1) {
        logger.info(`Allocation is not active`)
        return true
      }

      const receipt = await Ethereum.executeTransaction(
        this.contracts.staking.closeAllocation(allocation.id, poi, txOverrides),
        logger.child({ action: 'close' }),
        this.paused,
      )
      if (receipt === 'paused') {
        return false
      }
      logger.info(`Successfully closed allocation`)
      return true
    } catch (error) {
      logger.warn(`Failed to close allocation`, {
        error: error.message || error,
      })
      return false
    }
  }

  async claim(allocation: Allocation): Promise<boolean> {
    const logger = this.logger.child({
      allocation: allocation.id,
      deployment: allocation.subgraphDeployment.id.display,
      createdAtEpoch: allocation.createdAtEpoch,
      closedAtEpoch: allocation.closedAtEpoch,
      createdAtBlockHash: allocation.createdAtBlockHash,
    })
    try {
      logger.info(`Claim tokens from the rebate pool for allocation`)

      // Double-check whether the allocation is claimed to
      // avoid unnecessary transactions.
      // Note: We're checking the allocation state here, which is defined as
      //
      //     enum AllocationState { Null, Active, Closed, Finalized, Claimed }
      //
      // in the contracts.
      const state = await this.contracts.staking.getAllocationState(
        allocation.id,
      )
      if (state === 4) {
        logger.info(`Allocation rebate rewards already claimed`)
        return true
      }
      if (state === 1) {
        logger.info(`Allocation still active`)
        return true
      }

      // Claim the earned value from the rebate pool, returning it to the indexers stake
      await Ethereum.executeTransaction(
        this.contracts.staking.claim(allocation.id, true, txOverrides),
        logger.child({ action: 'claim' }),
        this.paused,
      )
      logger.info(`Successfully claimed allocation`)
      return true
    } catch (error) {
      logger.warn(`Failed to claim allocation`, {
        error: error.message || error,
      })
      return false
    }
  }

  async ensureMinimumStake(minimum: BigNumber): Promise<void> {
    try {
      this.logger.info(
        `Ensure enough is staked to be able to allocate to subgraphs`,
        {
          minimumGRT: formatGRT(minimum),
        },
      )

      // Check if the indexer account owns >= minimum GRT
      let tokens = await this.contracts.token.balanceOf(this.indexerAddress)

      this.logger.info(`Indexer account balance`, {
        amountGRT: formatGRT(tokens),
      })

      // Identify how many GRT the indexer has already staked
      const stakedTokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )

      // We're done if the indexer has staked enough already
      if (stakedTokens.gte(minimum)) {
        this.logger.info(`Indexer has sufficient stake`, {
          stakeGRT: formatGRT(stakedTokens),
          minimumGRT: formatGRT(minimum),
        })
        return
      }

      const missingStake = minimum.sub(stakedTokens)

      // Check if we have enough GRT to stake the missing amount
      if (tokens.lt(minimum)) {
        throw new Error(
          `The indexer account only owns ${formatGRT(
            tokens,
          )} GRT, but ${formatGRT(
            missingStake,
          )} GRT are needed for the minimum stake of ${formatGRT(minimum)} GRT`,
        )
      }

      this.logger.info(`Indexer has insufficient stake`, {
        stakeGRT: formatGRT(stakedTokens),
        minimumGRT: formatGRT(minimum),
        missingStake: formatGRT(missingStake),
      })

      this.logger.info(`Approve missing amount for staking`, {
        amount: formatGRT(missingStake),
      })

      // If not, make sure to stake the remaining amount

      // First, approve the missing amount for staking
      const approveReceipt = await Ethereum.executeTransaction(
        this.contracts.token.approve(
          this.contracts.staking.address,
          missingStake,
          txOverrides,
        ),
        this.logger.child({ action: 'approve' }),
        this.paused,
      )

      if (approveReceipt === 'paused') {
        return
      }

      const approveEvent = approveReceipt.events?.find(event =>
        event.topics.includes(
          this.contracts.token.interface.getEventTopic('Approval'),
        ),
      )
      if (!approveEvent) {
        throw new Error(
          `Failed to approve ${formatGRT(
            missingStake,
          )} GRT for staking: approval was never granted`,
        )
      }
      const approveEventInputs = this.contracts.token.interface.decodeEventLog(
        'Approval',
        approveEvent.data,
        approveEvent.topics,
      )

      this.logger.info(`Successfully approved missing stake`, {
        owner: approveEventInputs.owner,
        spender: approveEventInputs.spender,
      })

      // Then, stake the missing amount
      const stakeReceipt = await Ethereum.executeTransaction(
        this.contracts.staking.stake(missingStake, txOverrides),
        this.logger.child({ action: 'stake' }),
        this.paused,
      )

      if (stakeReceipt === 'paused') {
        return
      }

      const stakeEvent = stakeReceipt.events?.find(event =>
        event.topics.includes(
          this.contracts.staking.interface.getEventTopic('StakeDeposited'),
        ),
      )
      if (!stakeEvent) {
        throw new Error(
          `Failed to stake ${formatGRT(
            missingStake,
          )} GRT: the deposit never came through`,
        )
      }
      const stakeEventInputs = this.contracts.staking.interface.decodeEventLog(
        'StakeDeposited',
        stakeEvent.data,
        stakeEvent.topics,
      )

      this.logger.info(`Successfully staked`, {
        amountGRT: formatGRT(stakeEventInputs.tokens),
      })

      // Finally, confirm the new amount by logging it
      tokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )

      this.logger.info(`New stake`, {
        stakeGRT: formatGRT(tokens),
        minimum: formatGRT(minimum),
      })
    } catch (error) {
      this.logger.error(`Failed to stake GRT on behalf of indexer`, {
        address: this.indexerAddress,
        error,
      })
      throw error
    }
  }
}
