import {
  logging,
  contracts as networkContracts,
} from '@graphprotocol/common-ts'
import * as bs58 from 'bs58'
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

import { SubgraphDeploymentKey, Subgraph } from './types'

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: logging.Logger,
  ): Promise<ContractReceipt> {
    const tx = await transaction
    logger.info(`Transaction pending: '${tx.hash}'`)
    const receipt = await tx.wait(1)
    logger.info(
      `Transaction '${tx.hash}' successfully included in block #${receipt.blockNumber}`,
    )
    return receipt
  }

  static ipfsHashToBytes32(hash: string): string {
    return utils.hexlify(bs58.decode(hash).slice(2))
  }

  static bytesToIPSFHash(bytes: string): string {
    return bs58.encode(Ethereum.addQm(utils.arrayify(bytes)))
  }

  static addQm(a: Uint8Array): Uint8Array {
    const out = new Uint8Array(34)
    out[0] = 0x12
    out[1] = 0x20
    for (let i = 0; i < 32; i++) {
      out[i + 2] = a[i]
    }
    return out as Uint8Array
  }
}

const txOverrides = {
  gasLimit: 1000000,
  gasPrice: utils.parseUnits('25', 'gwei'),
}

export class Network {
  subgraph: ApolloClient<NormalizedCacheObject>
  contracts: networkContracts.NetworkContracts
  indexerAddress: string
  indexerUrl: string
  indexerGeoCoordinates: [string, string]
  mnemonic: string
  logger: logging.Logger

  private constructor(
    logger: logging.Logger,
    indexerAddress: string,
    indexerUrl: string,
    geoCoordinates: [string, string],
    contracts: networkContracts.NetworkContracts,
    mnemonic: string,
    subgraph: ApolloClient<NormalizedCacheObject>,
  ) {
    this.logger = logger
    this.indexerAddress = indexerAddress
    this.indexerUrl = indexerUrl
    this.indexerGeoCoordinates = geoCoordinates
    this.contracts = contracts
    this.mnemonic = mnemonic
    this.subgraph = subgraph
  }

  static async create(
    parentLogger: logging.Logger,
    ethereumProvider: string,
    network: string,
    indexerUrl: string,
    indexerGraphqlUrl: string,
    geoCoordinates: [string, string],
    mnemonic: string,
    networkSubgraphDeployment: string,
  ): Promise<Network> {
    const logger = parentLogger.child({ component: 'Network' })
    const subgraph = new ApolloClient({
      link: new HttpLink({
        uri: new URL(
          `/subgraphs/id/${networkSubgraphDeployment}`,
          indexerGraphqlUrl,
        ).toString(),
        fetch: fetch as never,
      }),
      cache: new InMemoryCache(),
    })
    let wallet = Wallet.fromMnemonic(mnemonic)
    const eth = new providers.JsonRpcProvider(ethereumProvider)

    logger.info(
      `Create a wallet instance connected to '${network}' via '${ethereumProvider}'`,
    )
    wallet = wallet.connect(eth)
    logger.info(`Wallet created at '${wallet.address}'`)

    logger.info(`Connecting to contracts`)
    const networkInfo = await eth.getNetwork()
    const contracts = await networkContracts.connectContracts(
      wallet,
      networkInfo.chainId,
    )
    logger.info(`Connected to contracts`)

    return new Network(
      logger,
      wallet.address,
      indexerUrl,
      geoCoordinates,
      contracts,
      mnemonic,
      subgraph,
    )
  }

  async subgraphDeploymentsWorthIndexing(): Promise<SubgraphDeploymentKey[]> {
    const minimumStake = 100
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
      return result.data.subgraphs
        .filter(
          (subgraph: Subgraph) =>
            subgraph.currentVersion.subgraphDeployment.totalStake >=
            minimumStake,
        )
        .map((subgraph: Subgraph) => {
          return {
            owner: subgraph.owner.id,
            subgraphDeploymentID: Ethereum.bytesToIPSFHash(
              subgraph.currentVersion.subgraphDeployment.id,
            ),
          } as SubgraphDeploymentKey
        })
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

  async allocate(subgraphDeploymentID: string): Promise<void> {
    const amount = 100
    const subgraphIdBytes = Ethereum.ipfsHashToBytes32(subgraphDeploymentID)

    const currentEpoch = await this.contracts.epochManager.currentEpoch()
    this.logger.info(
      `Stake on '${subgraphDeploymentID}' in epoch '${currentEpoch}'`,
    )
    const currentAllocation = await this.contracts.staking.getAllocation(
      this.indexerAddress,
      subgraphIdBytes,
    )

    if (currentAllocation.tokens.toNumber() > 0) {
      this.logger.info(`Stake already allocated to '${subgraphDeploymentID}'`)
      this.logger.info(
        `${currentAllocation.tokens} tokens allocated on channel '${
          currentAllocation.channelID
        }' since epoch ${currentAllocation.createdAtEpoch.toString()}`,
      )
      return
    }

    // Derive the subgraphDeploymentID specific public key
    const hdNode = utils.HDNode.fromMnemonic(this.mnemonic)
    const path =
      'm/' + [currentEpoch, ...Buffer.from(subgraphDeploymentID)].join('/')
    const derivedKeyPair = hdNode.derivePath(path)
    const publicKey = derivedKeyPair.publicKey
    const uncompressedPublicKey = utils.computePublicKey(publicKey)

    this.logger.debug(`Deriving channel key using path '${path}'`)

    const receipt = await Ethereum.executeTransaction(
      this.contracts.staking.allocate(
        subgraphIdBytes,
        amount,
        uncompressedPublicKey,
        this.indexerAddress,
        utils.parseUnits('0.01', '18'),
        txOverrides,
      ),
      this.logger,
    )

    const event = receipt.events?.find(event =>
      event.topics.includes(
        this.contracts.staking.interface.getEventTopic('AllocationCreated'),
      ),
    )
    assert.ok(event, `Failed to stake on '${subgraphDeploymentID}'`)

    const eventInputs = this.contracts.staking.interface.decodeEventLog(
      'AllocationCreated',
      event.data,
      event.topics,
    )
    this.logger.info(
      `${eventInputs.tokens} tokens staked on '${eventInputs.subgraphDeploymentID}', channel: ${eventInputs.channelID}, channelPubKey: ${eventInputs.channelPubKey}`,
    )
  }

  async ensureMinimumStake(minimum: number): Promise<void> {
    try {
      this.logger.info(
        `Ensure at least ${minimum} tokens are available for staking on subgraphs`,
      )
      let tokens = await this.contracts.token.balanceOf(this.indexerAddress)
      if (tokens <= BigNumber.from(minimum)) {
        this.logger.warn(
          `The indexer account has insufficient tokens, '${tokens}'. to ensure minimum stake. Please use an account with sufficient GRT`,
        )
      }
      this.logger.info(`The indexer account has '${tokens}' GRT`)
      const stakedTokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      if (stakedTokens >= BigNumber.from(minimum)) {
        this.logger.info(
          `Indexer has sufficient staking tokens: ${stakedTokens.toString()}`,
        )
        return
      }
      this.logger.info(`Amount staked: ${stakedTokens} tokens`)
      const diff = minimum - stakedTokens.toNumber()
      const stakeAmount = utils.parseUnits(String(diff), 1)
      this.logger.info(`Stake ${diff} tokens`)
      const approveReceipt = await Ethereum.executeTransaction(
        this.contracts.token.approve(
          this.contracts.staking.address,
          stakeAmount,
          txOverrides,
        ),
        this.logger,
      )

      const approveEvent = approveReceipt.events?.find(event =>
        event.topics.includes(
          this.contracts.token.interface.getEventTopic('Approval'),
        ),
      )
      assert.ok(approveEvent, `Failed to approve '${diff}' tokens for staking`)

      const approveEventInputs = this.contracts.token.interface.decodeEventLog(
        'Approval',
        approveEvent.data,
        approveEvent.topics,
      )
      this.logger.info(
        `${approveEventInputs.value} tokens approved for transfer, owner: '${approveEventInputs.owner}' spender: '${approveEventInputs.spender}'`,
      )

      const stakeReceipt = await Ethereum.executeTransaction(
        this.contracts.staking.stake(stakeAmount, txOverrides),
        this.logger,
      )

      const stakeEvent = stakeReceipt.events?.find(event =>
        event.topics.includes(
          this.contracts.staking.interface.getEventTopic('StakeDeposited'),
        ),
      )
      assert.ok(stakeEvent, `Failed to stake '${diff}'`)

      const stakeEventInputs = this.contracts.staking.interface.decodeEventLog(
        'StakeDeposited',
        stakeEvent.data,
        stakeEvent.topics,
      )
      this.logger.info(`${stakeEventInputs.tokens} tokens staked`)

      this.logger.info(`Staked ${diff} tokens`)
      tokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      this.logger.info(`Total stake: ${tokens}`)
    } catch (e) {
      this.logger.error(
        `Failed to stake tokens on behalf of indexer '${this.indexerAddress}'`,
      )
      throw e
    }
  }
}
