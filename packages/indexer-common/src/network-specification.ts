import {
  Address,
  toAddress,
  connectContracts,
  NetworkContracts,
} from '@graphprotocol/common-ts'
import { BigNumber, Wallet } from 'ethers'
import { validateNetworkIdentifier } from './parsers'
import { AllocationManagementMode } from './types'

const GATEWAY_COLLECT_ENDPOINT = 'collect-receipts'
const GATEWAY_VOUCHER_ENDPOINT = 'voucher'
const GATEWAY_PARTIAL_VOUCHER_ENDPOINT = 'partial-voucher'

// All necessary information to describe a Protocol Network
class NetworkSpecification {
  readonly networkIdentifier: string
  readonly gateway: Gateway
  readonly indexerOptions: IndexerOptions
  readonly transactionMonitoring: TransactionMonitoring
  readonly contracts: Contracts
  readonly subgraphs: ProtocolSubgraphs
  readonly networkProvider: NetworkProvider
  readonly dai: Dai | undefined

  constructor(
    networkIdentifier: string,
    gateway: Gateway,
    indexerOptions: IndexerOptions,
    transactionMonitoring: TransactionMonitoring,
    contracts: Contracts,
    subgraphs: ProtocolSubgraphs,
    networkProvider: NetworkProvider,
    dai?: Dai,
  ) {
    this.networkIdentifier = validateNetworkIdentifier(networkIdentifier)
    this.gateway = gateway
    this.indexerOptions = indexerOptions
    this.transactionMonitoring = transactionMonitoring
    this.contracts = contracts
    this.subgraphs = subgraphs
    this.networkProvider = networkProvider
    this.dai = dai
  }
}

// Gateway endpoints
class Gateway {
  readonly baseUrl: URL
  readonly collectEndpoint: URL
  readonly voucherEndpoint: URL
  readonly partialVoucherEndpoint: URL

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl)
    this.collectEndpoint = new URL(GATEWAY_COLLECT_ENDPOINT, this.baseUrl)
    this.voucherEndpoint = new URL(GATEWAY_VOUCHER_ENDPOINT, this.baseUrl)
    this.partialVoucherEndpoint = new URL(GATEWAY_PARTIAL_VOUCHER_ENDPOINT, this.baseUrl)
  }
}

// Indexer identification and network behavior opetions
class IndexerOptions {
  readonly address: Address
  readonly url: URL
  readonly geoCordinates: [string, string]
  readonly restakeRewards: boolean
  readonly rebateClaimThreshold: BigNumber
  readonly rebateClaimBatchThreshold: BigNumber
  readonly rebateClaimMaxBatchSize: number
  readonly poiDisputeMonitoring: boolean
  readonly poiDisputableEpochs: number
  readonly defaultAllocationAmount: BigNumber
  readonly voucherRedemptionThreshold: BigNumber
  readonly voucherRedemptionBatchThreshold: BigNumber
  readonly voucherRedemptionMaxBatchSize: number
  readonly allocationManagementMode: AllocationManagementMode
  readonly autoAllocationMinBatchSize: number

  constructor(
    address: string,
    url: string,
    geoCordinates: [string, string],
    restakeRewards: boolean,
    rebateClaimThreshold: string,
    rebateClaimBatchThreshold: string,
    rebateClaimMaxBatchSize: number,
    poiDisputeMonitoring: boolean,
    poiDisputableEpochs: number,
    defaultAllocationAmount: string,
    voucherRedemptionThreshold: string,
    voucherRedemptionBatchThreshold: string,
    voucherRedemptionMaxBatchSize: number,
    allocationManagementMode: string,
    autoAllocationMinBatchSize: number,
  ) {
    // TODO: validate input
    this.address = toAddress(address)
    this.url = new URL(url)
    this.geoCordinates = geoCordinates
    this.restakeRewards = restakeRewards
    this.rebateClaimThreshold = BigNumber.from(rebateClaimThreshold)
    this.rebateClaimBatchThreshold = BigNumber.from(rebateClaimBatchThreshold)
    this.rebateClaimMaxBatchSize = rebateClaimMaxBatchSize
    this.poiDisputeMonitoring = poiDisputeMonitoring
    this.poiDisputableEpochs = poiDisputableEpochs
    this.defaultAllocationAmount = BigNumber.from(defaultAllocationAmount)
    this.voucherRedemptionThreshold = BigNumber.from(voucherRedemptionThreshold)
    this.voucherRedemptionBatchThreshold = BigNumber.from(voucherRedemptionBatchThreshold)
    this.voucherRedemptionMaxBatchSize = voucherRedemptionMaxBatchSize
    this.autoAllocationMinBatchSize = autoAllocationMinBatchSize

    // Validates Allocation Management Mode
    if (
      Object.values(AllocationManagementMode).includes(
        allocationManagementMode as AllocationManagementMode,
      )
    ) {
      this.allocationManagementMode = allocationManagementMode as AllocationManagementMode
    } else {
      throw new Error(
        `Invalid allocation management mode: ${AllocationManagementMode}. ` +
          `Must be one of: ${Object.values(AllocationManagementMode)}`,
      )
    }
  }
}

// Transaction handling options
class TransactionMonitoring {
  readonly paused: boolean
  readonly isOperator: boolean
  readonly gasIncreaseTimeout: number
  readonly gasIncreaseFactor: number
  readonly baseFeePerGasMax: number
  readonly maxTransactionAttempts: number

  constructor(
    paused: boolean,
    isOperator: boolean,
    gasIncreaseTimeout: number,
    gasIncreaseFactor: number,
    baseFeePerGasMax: number,
    maxTransactionAttempts: number,
  ) {
    this.paused = paused
    this.isOperator = isOperator
    this.gasIncreaseTimeout = gasIncreaseTimeout
    this.gasIncreaseFactor = gasIncreaseFactor
    this.baseFeePerGasMax = baseFeePerGasMax
    this.maxTransactionAttempts = maxTransactionAttempts
  }
}

// TODO:L2: this is a high-level object (a component) and not a raw-data specification.
// It might not belong in the NetworkSpec class, but in Network.
class Contracts {
  declare networkContracts: NetworkContracts

  private constructor() {}

  // Asynchronous initialization
  static async connect(wallet: Wallet, networkIdentifier: number): Promise<Contracts> {
    const instance = new Contracts()
    const networkContracts = await connectContracts(wallet, networkIdentifier)
    instance.networkContracts = networkContracts
    return instance
  }
}

// Generic subgraph specification
class Subgraph {
  readonly httpEndpoint: string | undefined
  readonly deployment: string | undefined

  constructor(httpEndpoint?: string, deployment?: string) {
    if (!httpEndpoint && !deployment) {
      throw new Error('At least one of httpEndpoint or deployment must be set.')
    }

    this.httpEndpoint = httpEndpoint
    this.deployment = deployment
  }
}

// All pertinent subgraphs in the protocol
class ProtocolSubgraphs {
  readonly networkSubgraph: Subgraph
  readonly epochSubgraph: Subgraph

  constructor(networkSubgraph: Subgraph, epochSubgraph: Subgraph) {
    this.networkSubgraph = networkSubgraph
    this.epochSubgraph = epochSubgraph
  }
}

class NetworkProvider {
  readonly httpEndpoint: URL

  constructor(httpEndpoint: string) {
    this.httpEndpoint = new URL(httpEndpoint)
  }
}

class Dai {
  readonly contractAddress: Address

  constructor(contractAddress: string) {
    this.contractAddress = toAddress(contractAddress)
  }
}
