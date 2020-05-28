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
import { NetworkAddresses, SubgraphKey, SubgraphStake } from './types'

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
}

const txOverrides = {
  gasLimit: 1000000,
  gasPrice: utils.parseUnits('10', 'gwei'),
}

export class Network {
  subgraph: ApolloClient<NormalizedCacheObject>
  serviceRegistry: ServiceRegistry
  staking: Staking
  token: GraphToken
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
        uri: indexerGraphqlUrl + 'subgraphs/name/graphprotocol/network',
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
  }

  async subgraphs(): Promise<SubgraphKey[]> {
    const minimumStake = 0
    try {
      let result = await this.subgraph.query({
        query: gql`
          query {
            subgraphs {
              id
              totalStake
              versions {
                id
                version
                displayName
                description
                networks
                namedSubgraph {
                  id
                  name
                  nameSystem
                  owner {
                    id
                    name
                    balance
                  }
                }
              }
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return result.data.subgraphs
        .filter((subgraph: SubgraphStake) => {
          return subgraph.totalStake >= minimumStake
        })
        .map((subgraph: SubgraphStake) => {
          let latestVersion = subgraph.versions.sort(
            (a, b) => b.version - a.version,
          )[0]
          return {
            name: latestVersion.namedSubgraph.name,
            owner: latestVersion.namedSubgraph.owner.name,
            subgraphId: subgraph.id,
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
    let epoch = 0
    let amount = 100
    let subgraphIdBytes = Ethereum.ipfsHashToBytes32(subgraph)

    this.logger.info(`Stake on '${subgraph}'`)
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
    let path = 'm/' + [epoch, ...Buffer.from(subgraph)].join('/')
    let derivedKeyPair = hdNode.derivePath(path)
    let publicKey = derivedKeyPair.publicKey

    let receipt = await Ethereum.executeTransaction(
      this.staking.allocate(subgraphIdBytes, amount, publicKey, txOverrides),
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
      let tokens = await this.staking.getIndexerStakedTokens(
        this.indexerAddress,
      )
      if (tokens.toNumber() >= minimum) {
        this.logger.info(
          `Indexer has sufficient staking tokens: ${tokens.toString()}`,
        )
        return
      }
      this.logger.info(`Amount staked: ${tokens} tokens`)
      let diff = minimum - tokens.toNumber()
      this.logger.info(`Stake ${diff} tokens`)
      await Ethereum.executeTransaction(
        this.token.approve(this.staking.address, diff, txOverrides),
        this.logger,
      )
      await Ethereum.executeTransaction(
        this.staking.stake(diff, txOverrides),
        this.logger,
      )
      this.logger.info(`Staked ${diff} tokens`)
      tokens = await this.staking.getIndexerStakedTokens(this.indexerAddress)
      this.logger.info(`Total stake: ${tokens}`)
    } catch (e) {
      this.logger.error(
        `Failed to stake tokens for indexer '${this.indexerAddress}'`,
      )
      throw e
    }
  }
}
