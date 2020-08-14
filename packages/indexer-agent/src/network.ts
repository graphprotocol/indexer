import {
  Logger,
  NetworkContracts,
  connectContracts,
  SubgraphDeploymentID,
  formatGRT,
  parseGRT,
} from '@graphprotocol/common-ts'
import axios, { AxiosInstance } from 'axios'
import {
  ContractTransaction,
  ContractReceipt,
  BigNumber,
  providers,
  Wallet,
  utils,
} from 'ethers'
import { strict as assert } from 'assert'
import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import fetch from 'node-fetch'
import geohash from 'ngeohash'
import { getPublicIdentifierFromPublicKey } from '@connext/utils'
import { getCreate2MultisigAddress } from '@connext/cf-core/dist/utils'
import { JsonRpcProvider } from '@connext/types'
import { Allocation, IndexingRules } from './types'

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: Logger,
  ): Promise<ContractReceipt> {
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

const txOverrides = {
  gasLimit: 1000000,
  gasPrice: utils.parseUnits('25', 'gwei'),
}

export class Network {
  subgraph: ApolloClient<NormalizedCacheObject>
  contracts: NetworkContracts
  indexerAddress: string
  indexerUrl: string
  indexerGeoCoordinates: [string, string]
  mnemonic: string
  logger: Logger
  ethereumProvider: JsonRpcProvider
  connextNode: AxiosInstance

  private constructor(
    logger: Logger,
    indexerAddress: string,
    indexerUrl: string,
    geoCoordinates: [string, string],
    contracts: NetworkContracts,
    mnemonic: string,
    subgraph: ApolloClient<NormalizedCacheObject>,
    ethereumProvider: JsonRpcProvider,
    connextNode: AxiosInstance,
  ) {
    this.logger = logger
    this.indexerAddress = indexerAddress
    this.indexerUrl = indexerUrl
    this.indexerGeoCoordinates = geoCoordinates
    this.contracts = contracts
    this.mnemonic = mnemonic
    this.subgraph = subgraph
    this.ethereumProvider = ethereumProvider
    this.connextNode = connextNode
  }

  static async create(
    parentLogger: Logger,
    ethereumProviderUrl: string,
    indexerUrl: string,
    indexerGraphqlUrl: string,
    geoCoordinates: [string, string],
    mnemonic: string,
    networkSubgraphDeployment: SubgraphDeploymentID,
    connextNode: string,
  ): Promise<Network> {
    const logger = parentLogger.child({ component: 'Network' })

    const subgraph = new ApolloClient({
      link: new HttpLink({
        uri: new URL(
          `/subgraphs/id/${networkSubgraphDeployment.ipfsHash}`,
          indexerGraphqlUrl,
        ).toString(),
        fetch: fetch as never,
      }),
      cache: new InMemoryCache(),
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
    logger.info(`Successfully connected to contracts`)

    return new Network(
      logger,
      wallet.address,
      indexerUrl,
      geoCoordinates,
      contracts,
      mnemonic,
      subgraph,
      ethereumProvider,
      axios.create({
        baseURL: connextNode,
        responseType: 'json',
      }),
    )
  }

  async subgraphDeploymentsWorthIndexing(
    rules: IndexingRules[],
  ): Promise<SubgraphDeploymentID[]> {
    try {
      const result = await this.subgraph.query({
        query: gql`
          query {
            subgraphDeployments {
              id
              totalStake
              totalSignalMinted
              totalSubgraphIndexingRewards
              totalQueryFeesCollected
              indexerAllocations {
                indexer
                tokensAllocated
                feesCollected
              }
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return (
        result.data.subgraphDeployments
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((deployment: any) => {
            const deploymentRule = rules.find(
              rule => (rule.deployment = deployment.id),
            )

            // Skip the indexing rules checks if the decision basis is 'always' or 'never'
            if (deploymentRule?.decisionBasis == 'ALWAYS') {
              return true
            } else if (deploymentRule?.decisionBasis == 'NEVER') {
              return false
            }

            if (deploymentRule) {
              const stakedTokens = parseGRT(deployment.totalStake)
              const signalAmount = parseGRT(deployment.totalSignalMinted)
              const avgQueryFeeRewards = parseGRT(
                deployment.totalQueryFeesCollected,
              ).div(BigNumber.from(deployment.indexerAllocations.length))

              return (
                (deploymentRule.minStake?.lte(stakedTokens) ||
                  deploymentRule.minSignal?.lte(signalAmount) ||
                  deploymentRule.minAverageQueryFees?.lte(
                    avgQueryFeeRewards,
                  )) &&
                deploymentRule.maxSignal?.gte(signalAmount)
              )
            } else {
              throw 'No indexer rules found on indexer management server'
            }
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((deployment: any) => new SubgraphDeploymentID(deployment.id))
      )
    } catch (error) {
      this.logger.error(`Failed to query subgraphs on the network`)
      throw error
    }
  }

  async activeAllocations(): Promise<Allocation[]> {
    try {
      const result = await this.subgraph.query({
        query: gql`
          query allocations($indexer: String!) {
            allocations(where: { indexer: $indexer, status: Active }) {
              id
              allocatedTokens
              createdAtEpoch
              subgraphDeployment {
                id
                stakedTokens
                signalAmount
              }
            }
          }
        `,
        variables: {
          indexer: this.indexerAddress.toLocaleLowerCase(),
        },
        fetchPolicy: 'no-cache',
      })
      return result.data.allocations.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (allocation: any) => ({
          id: allocation.id,
          subgraphDeployment: {
            id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
            stakedTokens: parseGRT(allocation.subgraphDeployment.stakedTokens),
            signalAmount: parseGRT(allocation.subgraphDeployment.signalAmount),
          },
          allocatedTokens: parseGRT(allocation.allocatedTokens),
          createdAtEpoch: allocation.createdAtEpoch,
        }),
      )
    } catch (error) {
      this.logger.error(`Failed to query active indexer allocations`)
      throw error
    }
  }

  async deploymentAllocations(
    deployment: SubgraphDeploymentID,
  ): Promise<Allocation[]> {
    try {
      const result = await this.subgraph.query({
        query: gql`
          query allocations($indexer: String!, $deployment: String!) {
            allocations(
              where: {
                indexer: $indexer
                subgraphDeployment: $deployment
                status: Active
              }
            ) {
              id
              createdAtEpoch
              allocatedTokens
              subgraphDeployment {
                id
                stakedTokens
                signalAmount
              }
            }
          }
        `,
        variables: {
          indexer: this.indexerAddress.toLocaleLowerCase(),
          deployment: deployment.bytes32,
        },
        fetchPolicy: 'no-cache',
      })
      return result.data.allocations.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (allocation: any) => ({
          id: allocation.id,
          createdAtEpoch: allocation.createdAtEpoch,
          allocatedTokens: parseGRT(allocation.allocatedTokens),
          subgraphDeployment: {
            id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
            stakedTokens: parseGRT(allocation.subgraphDeployment.stakedTokens),
            signalAmount: parseGRT(allocation.subgraphDeployment.signalAmount),
          },
        }),
      )
    } catch (error) {
      this.logger.error(`Failed to query active indexer allocations`)
      throw error
    }
  }

  async register(): Promise<void> {
    const geoHash = geohash.encode(
      +this.indexerGeoCoordinates[0],
      +this.indexerGeoCoordinates[1],
    )

    try {
      this.logger.info(`Register indexer`, {
        address: this.indexerAddress,
        url: this.indexerUrl,
        geoCoordinates: this.indexerGeoCoordinates,
        geoHash,
      })

      // Register the indexer (only if it hasn't been registered yet or
      // if its URL is different from what is registered on chain)
      const isRegistered = await this.contracts.serviceRegistry.isRegistered(
        this.indexerAddress,
      )
      if (isRegistered) {
        const service = await this.contracts.serviceRegistry.services(
          this.indexerAddress,
        )
        if (service.url === this.indexerUrl) {
          this.logger.info(`Indexer already registered`, {
            address: this.indexerAddress,
            url: service.url,
            geoHash: service.geohash,
          })
          return
        }
      }

      const receipt = await Ethereum.executeTransaction(
        this.contracts.serviceRegistry.register(this.indexerUrl, geoHash, {
          gasLimit: 1000000,
          gasPrice: utils.parseUnits('10', 'gwei'),
        }),
        this.logger,
      )
      const event = receipt.events?.find(event =>
        event.topics.includes(
          this.contracts.serviceRegistry.interface.getEventTopic(
            'ServiceRegistered',
          ),
        ),
      )
      assert.ok(event)

      const eventInputs = this.contracts.serviceRegistry.interface.decodeEventLog(
        'ServiceRegistered',
        event.data,
        event.topics,
      )
      this.logger.info(`Successfully registered indexer`, {
        address: eventInputs.indexer,
        url: eventInputs.url,
        goeHash: eventInputs.geohash,
      })
    } catch (error) {
      this.logger.error(`Failed to register indexer`, {
        address: this.indexerAddress,
        url: this.indexerUrl,
        error,
      })
      throw error
    }
  }

  async allocate(deployment: SubgraphDeploymentID): Promise<void> {
    const amount = parseGRT('1')
    const price = parseGRT('0.01')

    this.logger.info(`Identify current allocation`, {
      deployment: deployment.display,
    })
    const currentAllocations = await this.deploymentAllocations(deployment)
    this.logger.info(`Current allocations`, { allocations: currentAllocations })

    // For now: Cannot allocate (for now) if we have already allocated to this
    // subgraph
    if (currentAllocations.length > 0) {
      this.logger.info(`Already allocated on subgraph deployment`, {
        deployment: deployment.display,
        amountGRT: formatGRT(currentAllocations[0].allocatedTokens),
        channel: currentAllocations[0].id,
        epoch: currentAllocations[0].createdAtEpoch,
      })
      return
    }

    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    this.logger.info(`Allocate to subgraph deployment`, {
      deployment: deployment.display,
      amountGRT: formatGRT(amount),
      epoch: currentEpoch.toString(),
    })

    // Derive the deployment specific public key
    const hdNode = utils.HDNode.fromMnemonic(this.mnemonic)
    const path =
      'm/' + [currentEpoch, ...Buffer.from(deployment.ipfsHash)].join('/')
    const derivedKeyPair = hdNode.derivePath(path)
    const publicKey = derivedKeyPair.publicKey
    const uncompressedPublicKey = utils.computePublicKey(publicKey)

    this.logger.debug(`Deriving channel key`, { path })

    // CREATE2 address for the channel
    const channelIdentifier = getPublicIdentifierFromPublicKey(
      uncompressedPublicKey,
    )
    const network = await this.ethereumProvider.getNetwork()
    const nodeConfig = await this.connextNode.get(
      `/api/config/${network.chainId}`,
    )
    const create2Address = await getCreate2MultisigAddress(
      channelIdentifier,
      nodeConfig.data.nodeIdentifier,
      nodeConfig.data.contractAddresses[network.chainId],
      this.ethereumProvider,
    )

    this.logger.debug(`Identified channel proxy address`, { create2Address })

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

    this.logger.info(`Allocate`, {
      deployment: deployment.display,
      amount: formatGRT(amount),
      uncompressedPublicKey,
      create2Address,
      price,
      txOverrides,
    })

    const receipt = await Ethereum.executeTransaction(
      this.contracts.staking.allocate(
        deployment.bytes32,
        amount,
        uncompressedPublicKey,
        create2Address,
        price,
        txOverrides,
      ),
      this.logger,
    )

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

    this.logger.info(`Successfully allocated to subgraph deployment`, {
      deployment: new SubgraphDeploymentID(eventInputs.subgraphDeploymentID)
        .display,
      amountGRT: formatGRT(eventInputs.tokens),
      channel: eventInputs.channelID,
      channelPubKey: eventInputs.channelPubKey,
      epoch: eventInputs.epoch.toString(),
    })
  }

  async settle(allocation: Allocation): Promise<void> {
    try {
      this.logger.info(`Settle allocation`, {
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })
      await this.contracts.staking.settle(allocation.id)
      this.logger.info(`Settled allocation`, {
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        createdAtEpoch: allocation.createdAtEpoch,
      })
    } catch (error) {
      this.logger.warn(`Failed to settle allocation`, {
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id,
        createdAtEpoch: allocation.createdAtEpoch,
        error: error.message,
      })
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
        this.logger,
      )
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
        this.logger,
      )
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
