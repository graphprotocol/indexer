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

import { SubgraphDeploymentKey, Subgraph } from './types'
import { JsonRpcProvider } from '@connext/types'

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: Logger,
  ): Promise<ContractReceipt> {
    const tx = await transaction
    logger.info(`Transaction pending: '${tx.hash}'`)
    const receipt = await tx.wait(1)
    logger.info(
      `Transaction '${tx.hash}' successfully included in block #${receipt.blockNumber}`,
    )
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
    network: string,
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
    let wallet = Wallet.fromMnemonic(mnemonic)
    const ethereumProvider = new providers.JsonRpcProvider(ethereumProviderUrl)

    logger.info(
      `Create a wallet instance connected to '${network}' via '${ethereumProviderUrl}'`,
    )
    wallet = wallet.connect(ethereumProvider)
    logger.info(`Wallet created at '${wallet.address}'`)

    logger.info(`Connecting to contracts`)
    const networkInfo = await ethereumProvider.getNetwork()
    const contracts = await connectContracts(wallet, networkInfo.chainId)
    logger.info(`Connected to contracts`)

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

  async subgraphDeploymentsWorthIndexing(): Promise<SubgraphDeploymentKey[]> {
    const minimumStake = parseGRT('100')

    try {
      const result = await this.subgraph.query({
        query: gql`
          query {
            subgraphs(where: { currentVersion_not: null }) {
              id
              totalNameSignaledGRT
              totalNameSignalMinted
              owner {
                id
              }
              currentVersion {
                id
                subgraphDeployment {
                  id
                  totalStake
                }
              }
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return (
        result.data.subgraphs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((subgraph: any) => {
            const deployment = subgraph.currentVersion.subgraphDeployment
            const totalStake = BigNumber.from(deployment.totalStake)
            return totalStake.gte(minimumStake)
          })
          .map((subgraph: Subgraph) => {
            return {
              owner: subgraph.owner.id,
              subgraphDeploymentID: new SubgraphDeploymentID(
                subgraph.currentVersion.subgraphDeployment.id,
              ),
            } as SubgraphDeploymentKey
          })
      )
    } catch (error) {
      this.logger.error(`Network subgraphs query failed`)
      throw error
    }
  }

  async register(): Promise<void> {
    try {
      this.logger.info(`Register indexer at '${this.indexerUrl}'`)
      const isRegistered = await this.contracts.serviceRegistry.isRegistered(
        this.indexerAddress,
      )
      if (isRegistered) {
        this.logger.info(
          `Indexer '${this.indexerAddress}' already registered with the network at '${this.indexerUrl}'`,
        )
        return
      }

      const receipt = await Ethereum.executeTransaction(
        this.contracts.serviceRegistry.register(
          this.indexerUrl,
          geohash.encode(
            +this.indexerGeoCoordinates[0],
            +this.indexerGeoCoordinates[1],
          ),
          {
            gasLimit: 1000000,
            gasPrice: utils.parseUnits('10', 'gwei'),
          },
        ),
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
      this.logger.info(
        `Registered indexer publicKey: '${eventInputs.indexer}' url: '${eventInputs.url}' geoHash: '${eventInputs.geohash}'`,
      )
    } catch (e) {
      this.logger.error(`Failed to register indexer at '${this.indexerUrl}'`)
      throw e
    }
  }

  async allocate(deployment: SubgraphDeploymentID): Promise<void> {
    const amount = parseGRT('1')
    const price = parseGRT('0.01')

    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    this.logger.info(
      `Allocate ${formatGRT(
        amount,
      )} GRT to '${deployment}' in epoch '${currentEpoch}'`,
    )
    const currentAllocation = await this.contracts.staking.getAllocation(
      this.indexerAddress,
      deployment.bytes32,
    )

    // Cannot allocate (for now) if we have already allocated to this subgraph
    if (currentAllocation.tokens.gt('0')) {
      this.logger.info(
        `Already allocated ${formatGRT(
          currentAllocation.tokens,
        )} GRT to '${deployment}' using channel '${
          currentAllocation.channelID
        }' since epoch ${currentAllocation.createdAtEpoch.toString()}`,
      )
      return
    }

    // Derive the deployment specific public key
    const hdNode = utils.HDNode.fromMnemonic(this.mnemonic)
    const path =
      'm/' + [currentEpoch, ...Buffer.from(deployment.ipfsHash)].join('/')
    const derivedKeyPair = hdNode.derivePath(path)
    const publicKey = derivedKeyPair.publicKey
    const uncompressedPublicKey = utils.computePublicKey(publicKey)

    this.logger.debug(`Deriving channel key using path '${path}'`)

    // CREATE2 address for the channel
    const channelIdentifier = getPublicIdentifierFromPublicKey(
      uncompressedPublicKey,
    )
    const nodeConfig = await this.connextNode.get('/config')
    const create2Address = await getCreate2MultisigAddress(
      channelIdentifier,
      nodeConfig.data.nodeIdentifier,
      nodeConfig.data.contractAddresses,
      this.ethereumProvider,
    )

    this.logger.debug(`Using '${create2Address}' as the channel proxy address`)

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
    assert.ok(event, `Failed to stake on '${deployment.bytes32}'`)

    const eventInputs = this.contracts.staking.interface.decodeEventLog(
      'AllocationCreated',
      event.data,
      event.topics,
    )
    this.logger.info(
      `${eventInputs.tokens} tokens staked on '${new SubgraphDeploymentID(
        eventInputs.subgraphDeploymentID,
      )}', channel: ${eventInputs.channelID}, channelPubKey: ${
        eventInputs.channelPubKey
      }`,
    )
  }

  async ensureMinimumStake(minimum: BigNumber): Promise<void> {
    try {
      this.logger.info(
        `Ensure at least ${formatGRT(
          minimum,
        )} GRT are staked to be able to allocate on subgraphs`,
      )

      // Check if the indexer account owns >= minimum GRT
      let tokens = await this.contracts.token.balanceOf(this.indexerAddress)

      this.logger.info(`The indexer account owns ${tokens} GRT`)

      // Identify how many GRT the indexer has already staked
      const stakedTokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )

      // We're done if the indexer has staked enough already
      if (stakedTokens.gte(minimum)) {
        this.logger.info(
          `Currently staked ${formatGRT(
            stakedTokens,
          )} GRT, which is enough for the minimum of ${formatGRT(minimum)} GRT`,
        )
        return
      }

      const missingStake = minimum.sub(stakedTokens)

      // Check if we have enough tokens to stake the missing amount
      if (tokens.lt(minimum)) {
        throw new Error(
          `The indexer account only owns ${formatGRT(
            tokens,
          )} GRT, but ${formatGRT(
            missingStake,
          )} GRT are needed for the minimum stake of ${formatGRT(minimum)} GRT`,
        )
      }

      this.logger.info(
        `Currently staked ${formatGRT(
          stakedTokens,
        )} GRT, need to stake another ${formatGRT(missingStake)} GRT`,
      )

      this.logger.info(`Approve ${formatGRT(missingStake)} GRT for staking`)

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
      assert.ok(
        approveEvent,
        `Failed to approve '${formatGRT(missingStake)}' GRT for staking`,
      )
      const approveEventInputs = this.contracts.token.interface.decodeEventLog(
        'Approval',
        approveEvent.data,
        approveEvent.topics,
      )

      this.logger.info(
        `${formatGRT(
          approveEventInputs.value,
        )} GRT approved for staking, owner: '${
          approveEventInputs.owner
        }' spender: '${approveEventInputs.spender}'`,
      )

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
      assert.ok(stakeEvent, `Failed to stake ${formatGRT(missingStake)} GRT`)
      const stakeEventInputs = this.contracts.staking.interface.decodeEventLog(
        'StakeDeposited',
        stakeEvent.data,
        stakeEvent.topics,
      )

      this.logger.info(
        `Successfully staked ${formatGRT(stakeEventInputs.tokens)} GRT`,
      )

      // Finally, confirm the new amount by logging it
      tokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      this.logger.info(
        `New stake: ${formatGRT(tokens)} (minimum: ${formatGRT(minimum)} GRT)`,
      )
    } catch (e) {
      this.logger.error(
        `Failed to stake tokens on behalf of indexer '${this.indexerAddress}': ${e}`,
      )
      throw e
    }
  }
}
