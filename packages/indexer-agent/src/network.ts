import { logging } from '@graphprotocol/common-ts'
import * as bs58 from 'bs58'
import { ContractTransaction, ethers, Wallet, utils } from 'ethers'
import { ContractReceipt } from 'ethers/contract'
import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'

import { ServiceRegistryFactory } from './contracts/ServiceRegistryFactory'
import { ServiceRegistry } from './contracts/ServiceRegistry'
import { Staking } from './contracts/Staking'
import { StakingFactory } from './contracts/StakingFactory'
import { GraphToken } from './contracts/GraphToken'
import { GraphTokenFactory } from './contracts/GraphTokenFactory'
import { EpochManager } from './contracts/EpochManager'
import { EpochManagerFactory } from './contracts/EpochManagerFactory'
import { Gns } from './contracts/Gns'
import { GnsFactory } from './contracts/GnsFactory'
import { NetworkAddresses, SubgraphKey, NetworkSubgraph } from './types'

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
  serviceRegistry: ServiceRegistry
  staking: Staking
  gns: Gns
  token: GraphToken
  epochManager: EpochManager
  indexerAddress: string
  indexerUrl: string
  indexerGeoCoordinates: [string, string]
  mnemonic: string
  logger: logging.Logger

  constructor(
    logger: logging.Logger,
    ethereumProvider: string,
    network: string,
    indexerUrl: string,
    indexerGraphqlUrl: string,
    geoCoordinates: [string, string],
    mnemonic: string,
  ) {
    this.logger = logger.child({ component: 'Network' })
    this.subgraph = new ApolloClient({
      link: new HttpLink({
        uri: new URL('/subgraphs/name/graphprotocol/network', indexerGraphqlUrl).toString,
        fetch,
      }),
      cache: new InMemoryCache(),
    })
    let wallet = Wallet.fromMnemonic(mnemonic)
    let eth = new ethers.providers.JsonRpcProvider(ethereumProvider)

    this.logger.info(
      `Create a wallet instance connected to '${network}' via '${ethereumProvider}'`,
    )
    wallet = wallet.connect(eth)
    this.logger.info(`Wallet created at '${wallet.address}'`)

    this.mnemonic = mnemonic
    this.indexerGeoCoordinates = geoCoordinates
    this.indexerAddress = wallet.address
    this.indexerUrl = indexerUrl

    const addresses: NetworkAddresses = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'addresses.json'), 'utf-8'),
    )
    this.serviceRegistry = ServiceRegistryFactory.connect(
      addresses[network as keyof NetworkAddresses].ServiceRegistry,
      wallet,
    )
    this.staking = StakingFactory.connect(
      addresses[network as keyof NetworkAddresses].Staking,
      wallet,
    )
    this.token = GraphTokenFactory.connect(
      addresses[network as keyof NetworkAddresses].GraphToken,
      wallet,
    )
    this.gns = GnsFactory.connect(
      addresses[network as keyof NetworkAddresses].GNS,
      wallet,
    )
    this.epochManager = EpochManagerFactory.connect(
      addresses[network as keyof NetworkAddresses].EpochManager,
      wallet,
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
      this.logger.info(`Register indexer at '${this.indexerUrl}`)
      let isRegistered = await this.serviceRegistry.isRegistered(
        this.indexerAddress,
      )
      if (isRegistered) {
        this.logger.info(
          `Indexer '${this.indexerAddress}' already registered with the network at '${this.indexerUrl}'`,
        )
        return
      }

      let receipt = await Ethereum.executeTransaction(
        this.serviceRegistry.register(
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

      let event = receipt.events!.find(
        event =>
          event.eventSignature ==
          this.serviceRegistry.interface.events.ServiceRegistered.signature,
      )
      assert.ok(event)

      let eventInputs = this.serviceRegistry.interface.events.ServiceRegistered.decode(
        event!.data,
        event!.topics,
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

    let currentEpoch = await this.epochManager.currentEpoch()
    this.logger.info(`Stake on '${subgraph}' in epoch '${currentEpoch}'`)
    let currentAllocation = await this.staking.getAllocation(
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

    let event = receipt.events!.find(
      event =>
        event.eventSignature ==
        this.staking.interface.events.AllocationCreated.signature,
    )
    assert.ok(event, `Failed to stake on subgraph '${subgraph}'`)

    let eventInputs = this.staking.interface.events.AllocationCreated.decode(
      event!.data,
      event!.topics,
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
      let tokens = await this.token.balanceOf(this.indexerAddress)
      if (tokens <= ethers.utils.bigNumberify(minimum)) {
        this.logger.warn(
          `The indexer account has insufficient tokens, '${tokens}'. to ensure minimum stake. Please use an account with sufficient GRT`,
        )
      }
      this.logger.info(`The indexer account has '${tokens}' GRT`)
      let approvedTokens = await this.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      if (approvedTokens >= ethers.utils.bigNumberify(minimum)) {
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
        this.token.approve(this.staking.address, stakeAmount, txOverrides),
        this.logger,
      )
      let approveEvent = approveReceipt.events!.find(
        event =>
          event.eventSignature ==
          this.token.interface.events.Approval.signature,
      )
      assert.ok(
        approveEvent,
        `Failed to approve '${diff}' tokens for staking`,
      )

      let approveEventInputs = this.token.interface.events.Approval.decode(
        approveEvent!.data,
        approveEvent!.topics,
      )
      this.logger.info(
        `${approveEventInputs.value} tokens approved for transfer, owner: '${approveEventInputs.owner}' spender: '${approveEventInputs.spender}'`,
      )

      let stakeReceipt = await Ethereum.executeTransaction(
        this.staking.stake(stakeAmount, txOverrides),
        this.logger,
      )

      let stakeEvent = stakeReceipt.events!.find(
        event =>
          event.eventSignature ==
          this.staking.interface.events.StakeDeposited.signature,
      )
      assert.ok(stakeEvent, `Failed to stake '${diff}'`)

      let stakeEventInputs = this.staking.interface.events.StakeDeposited.decode(
        stakeEvent!.data,
        stakeEvent!.topics,
      )
      this.logger.info(
        `${stakeEventInputs.tokens} tokens staked`,
      )

      this.logger.info(`Staked ${diff} tokens`)
      tokens = await this.staking.getIndexerStakedTokens(this.indexerAddress)
      this.logger.info(`Total stake: ${tokens}`)
    } catch (e) {
      this.logger.error(
        `Failed to stake tokens on behalf of indexer '${this.indexerAddress}'`,
      )
      throw e
    }
  }
}
