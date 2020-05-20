import { logging } from '@graphprotocol/common-ts'
import * as bs58 from 'bs58'
import { ContractTransaction, ethers, Wallet, utils } from 'ethers'
import { ContractReceipt } from 'ethers/contract'

import { ServiceRegistryFactory } from './contracts/ServiceRegistryFactory'
import { ServiceRegistry } from './contracts/ServiceRegistry'
import { Staking } from './contracts/Staking'
import { StakingFactory } from './contracts/StakingFactory'
import { GraphToken } from './contracts/GraphToken'
import { GraphTokenFactory } from './contracts/GraphTokenFactory'
import { SubgraphKey } from './types'

// TODO: Determine how contract addresses and network are set
//  Should they be fetched from the contracts repo? Set as optional startup parameters?
const SERVICE_REGISTRY_CONTRACT = '0xe982E462b094850F12AF94d21D470e21bE9D0E9C'
const STAKING_CONTRACT = '0xD833215cBcc3f914bD1C9ece3EE7BF8B14f841bb'
const GRAPH_TOKEN_CONTRACT = '0xCfEB869F69431e42cdB54A4F4f105C19C080A601'
const NETWORK = 'ropsten'

class Ethereum {
  static async executeTransaction(
    transaction: Promise<ContractTransaction>,
    logger: logging.Logger,
  ): Promise<ContractReceipt> {
    let tx = await transaction
    logger.info(`Transaction pending: '${tx.hash}'`)
    let receipt = await tx.wait(1)
    logger.info(
      `Transaction successfully included in block #${receipt.blockNumber}`,
    )
    let receipt = await tx.wait(5)
    console.log(`transaction successful!`)
    return receipt
  }

  static ipfsHashToBytes32(hash: string): Buffer {
    return bs58.decode(hash).slice(2)
  }
}

export class Network {
  serviceRegistry: ServiceRegistry
  staking: Staking
  token: GraphToken
  indexerPubKey: string
  indexerUrl: string
  mnemonic: string
  logger: logging.Logger

  constructor(
    logger: logging.Logger,
    ethereumProvider: string,
    network: string,
    indexerUrl: string,
    mnemonic: string,
  ) {
    this.logger = logger.child({ component: 'Network' })
    let wallet = Wallet.fromMnemonic(mnemonic)
    let eth = new ethers.providers.JsonRpcProvider(ethereumProvider)

    this.logger.info(
      `Create a wallet instance connected to '${network}' via '${ethereumProvider}'`,
    )
    wallet = wallet.connect(eth)
    this.logger.info(`Wallet created at '${wallet.address}'`)

    this.mnemonic = mnemonic
    this.indexerPubKey = wallet.address
    this.indexerUrl = indexerUrl

    this.serviceRegistry = ServiceRegistryFactory.connect(
      SERVICE_REGISTRY_CONTRACT,
      wallet,
    )
    this.staking = StakingFactory.connect(STAKING_CONTRACT, wallet)
    this.token = GraphTokenFactory.connect(GRAPH_TOKEN_CONTRACT, wallet)
  }

  async subgraphs(): Promise<SubgraphKey[]> {
    return [
      {
        name: 'DAOism/innerdao',
        subgraphId: 'QmXsVSmFN7b5vNNia2JPbeE7NLkVHPPgZS2cHsvfH6myuV',
      },
    ]
  }

  async register(): Promise<void> {
    try {
      let receipt = await Ethereum.executeTransaction(
        this.serviceRegistry.functions.register(this.indexerUrl, 'mammoth', {
          gasLimit: 1000000,
          gasPrice: 10000000000,
        }),
      )
      if (receipt) {
        return receipt.transactionHash
      }
      throw Error(`Failed to register ${url} on the network`)
    } catch (error) {
      throw error
    }
  }

  async unregister(url: string): Promise<string | undefined> {
    try {
      let receipt = await Ethereum.executeTransaction(
        this.serviceRegistry.contract.functions.unregister(url, {
          gasLimit: 1000000,
          gasPrice: 10000000000,
        }),
        this.logger
      )
      if (receipt) {
        return receipt.transactionHash
      }
      throw Error(`Failed to unregister ${url} from the network`)
    } catch (error) {
      throw error
    }
  }

  async stake(subgraph: string): Promise<void> {
    try {
      let epoch = 0
      let amount = 100
      let subgraphIdBytes = Ethereum.ipfsHashToBytes32(subgraph)

      this.logger.info(`Stake on '${subgraph}`)
      let currentAllocation = await this.staking.functions.getAllocation(
        this.indexerPubKey,
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
        this.staking.functions.allocate(subgraphIdBytes, amount, publicKey, {
          gasLimit: 1000000,
          gasPrice: utils.parseUnits('10', 'gwei'),
        }),
        this.logger,
      )

      if (receipt && receipt.events) {
        let event = receipt.events.find(
          event =>
            event.eventSignature ==
            this.staking.interface.events.AllocationCreated.signature,
        )
        if (event) {
          let eventInputs = this.staking.interface.events.AllocationCreated.decode(
            event.data,
            event.topics,
          )
          this.logger
            .info(`${eventInputs.tokens} tokens staked on ${eventInputs.subgraphID}
                                  channelID: ${eventInputs.channelID},
                                  channelPubKey: ${eventInputs.channelPubKey}`)
          return
        }
      }
      throw Error(`Failed to stake on subgraph '${subgraph}'`)
    } catch (error) {
      throw error
    }
  }
}
