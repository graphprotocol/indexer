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

import { SubgraphKey, NetworkSubgraph } from './types'

const fetch = require('node-fetch')
const geohash = require('ngeohash')

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: logging.Logger,
  ): Promise<ContractReceipt> {
    let tx = await transaction
    logger.info(`Transaction pending: '${tx.hash}'`)
    let receipt = await tx.wait(1)
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
    let out = new Uint8Array(34)
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
    let logger = parentLogger.child({ component: 'Network' })
    let subgraph = new ApolloClient({
      link: new HttpLink({
        uri: new URL(
          `/subgraphs/id/${networkSubgraphDeployment}`,
          indexerGraphqlUrl,
        ).toString(),
        fetch,
      }),
      cache: new InMemoryCache(),
    })
    let wallet = Wallet.fromMnemonic(mnemonic)
    let eth = new providers.JsonRpcProvider(ethereumProvider)

    logger.info(
      `Create a wallet instance connected to '${network}' via '${ethereumProvider}'`,
    )
    wallet = wallet.connect(eth)
    logger.info(`Wallet created at '${wallet.address}'`)

    logger.info(`Connecting to contracts`)
    let networkInfo = await eth.getNetwork()
    let contracts = await networkContracts.connectContracts(
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

  async subgraphs(): Promise<SubgraphKey[]> {
    const minimumStake = 100
    try {
      let result = await this.subgraph.query({
        query: gql`
          query {
            subgraphs(where: { currentVersion_not: null }) {
              id
              totalNameSignaledGRT
              totalNameSignalMinted
              owner {
                id
                defaultName {
                  id
                  nameSystem
                  name
                }
              }
              name
              currentVersion {
                id
                unpublished
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
        .filter((subgraph: NetworkSubgraph) => {
          return (
            subgraph.currentVersion.subgraphDeployment.totalStake >=
            minimumStake
          )
        })
        .map((subgraph: NetworkSubgraph) => {
          return {
            name: subgraph.name,
            owner: subgraph.owner
              ? subgraph.owner.defaultName.name
              : 'indexer-agent',
            subgraphId: Ethereum.bytesToIPSFHash(
              subgraph.currentVersion.subgraphDeployment.id,
            ),
          } as SubgraphKey
        })
    } catch (error) {
      this.logger.error(`Network subgraphs query failed`)
      throw error
    }
  }

  async register(): Promise<void> {
    try {
      this.logger.info(`Register indexer at '${this.indexerUrl}'`)
      let isRegistered = await this.contracts.serviceRegistry.isRegistered(
        this.indexerAddress,
      )
      if (isRegistered) {
        this.logger.info(
          `Indexer '${this.indexerAddress}' already registered with the network at '${this.indexerUrl}'`,
        )
        return
      }

      let receipt = await Ethereum.executeTransaction(
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

      let event = receipt.events!.find(event =>
        event.topics.includes(
          this.contracts.serviceRegistry.interface.getEventTopic(
            'ServiceRegistered',
          ),
        ),
      )
      assert.ok(event)

      let eventInputs = this.contracts.serviceRegistry.interface.decodeEventLog(
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

  async stake(subgraph: string): Promise<void> {
    let amount = 100
    let subgraphIdBytes = Ethereum.ipfsHashToBytes32(subgraph)

    let currentEpoch = await this.contracts.epochManager.currentEpoch()
    this.logger.info(`Stake on '${subgraph}' in epoch '${currentEpoch}'`)
    let currentAllocation = await this.contracts.staking.getAllocation(
      this.indexerAddress,
      subgraphIdBytes,
    )

    if (currentAllocation.tokens.toNumber() > 0) {
      this.logger.info(`Stake already allocated to '${subgraph}'`)
      this.logger.info(
        `${currentAllocation.tokens} tokens allocated on channelID '${
          currentAllocation.channelID
        }' since epoch ${currentAllocation.createdAtEpoch.toString()}`,
      )
      return
    }

    // Derive the subgraph specific public key
    let hdNode = utils.HDNode.fromMnemonic(this.mnemonic)
    let path = 'm/' + [currentEpoch, ...Buffer.from(subgraph)].join('/')
    let derivedKeyPair = hdNode.derivePath(path)
    let publicKey = derivedKeyPair.publicKey

    let receipt = await Ethereum.executeTransaction(
      this.staking.allocate(
        subgraphIdBytes,
        amount,
        publicKey,
        this.indexerAddress,
        utils.parseUnits('0.01', '18'),
        txOverrides,
      ),
      this.logger,
    )

    let event = receipt.events!.find(event =>
      event.topics.includes(
        this.contracts.staking.interface.getEventTopic('AllocationCreated'),
      ),
    )
    assert.ok(event, `Failed to stake on subgraph '${subgraph}'`)

    let eventInputs = this.contracts.staking.interface.decodeEventLog(
      'AllocationCreated',
      event.data,
      event.topics,
    )
    this.logger.info(
      `${eventInputs.tokens} tokens staked on ${eventInputs.subgraphID} channelID: ${eventInputs.channelID} channelPubKey: ${eventInputs.channelPubKey}`,
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
      let approvedTokens = await this.contracts.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      if (approvedTokens >= BigNumber.from(minimum)) {
        this.logger.info(
          `Indexer has sufficient staking tokens: ${approvedTokens.toString()}`,
        )
        return
      }
      this.logger.info(`Amount staked: ${approvedTokens} tokens`)
      let diff = minimum - approvedTokens.toNumber()
      let stakeAmount = utils.parseUnits(String(diff), 1)
      this.logger.info(`Stake ${diff} tokens`)
      let approveReceipt = await Ethereum.executeTransaction(
        this.contracts.token.approve(
          this.contracts.staking.address,
          stakeAmount,
          txOverrides,
        ),
        this.logger,
      )

      let approveEvent = approveReceipt.events!.find(event =>
        event.topics.includes(
          this.contracts.token.interface.getEventTopic('Approval'),
        ),
      )
      assert.ok(approveEvent, `Failed to approve '${diff}' tokens for staking`)

      let approveEventInputs = this.contracts.token.interface.decodeEventLog(
        'Approval',
        approveEvent.data,
        approveEvent.topics,
      )
      this.logger.info(
        `${approveEventInputs.value} tokens approved for transfer, owner: '${approveEventInputs.owner}' spender: '${approveEventInputs.spender}'`,
      )

      let stakeReceipt = await Ethereum.executeTransaction(
        this.contracts.staking.stake(stakeAmount, txOverrides),
        this.logger,
      )

      let stakeEvent = stakeReceipt.events!.find(event =>
        event.topics.includes(
          this.contracts.staking.interface.getEventTopic('StakeDeposited'),
        ),
      )
      assert.ok(stakeEvent, `Failed to stake '${diff}'`)

      let stakeEventInputs = this.contracts.staking.interface.decodeEventLog(
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
