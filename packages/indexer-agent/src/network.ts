import { logging } from '@graphprotocol/common-ts'
import { ContractTransaction, Wallet } from 'ethers'
import { ContractReceipt } from 'ethers/contract'

import { ServiceRegistryFactory } from './contracts/ServiceRegistryFactory'
import { ServiceRegistry } from './contracts/ServiceRegistry'
import { SubgraphKey } from './types'

// TODO: Determine how contract addresses and network are set
//  Should they be fetched from the contracts repo? Set as optional startup parameters?
const SERVICE_REGISTRY_CONTRACT = 'contract-address'
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
}

export class Network {
  serviceRegistry: ServiceRegistry
  logger: logging.Logger

  constructor(logger: logging.Logger, wallet: Wallet) {
    this.serviceRegistry = ServiceRegistryFactory.connect(
      SERVICE_REGISTRY_CONTRACT,
      wallet,
    )
    this.logger = logger.child({ component: 'Network' })
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
}
