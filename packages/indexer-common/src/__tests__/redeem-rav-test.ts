import { AllocationReceiptCollector } from './../allocations/query-fees'
import { AllocationStatus, SubgraphDeployment } from '@graphprotocol/indexer-common'
import {
  Logger,
  Metrics,
  Eventual,
  SubgraphDeploymentID,
  EventualValue,
} from '@graphprotocol/common-ts'
import { BigNumber, Contract, providers, Wallet } from 'ethers'
import {
  Gateway,
  IndexerOptions,
  TransactionMonitoring,
} from './../network-specification'
import {
  NetworkContracts as EscrowContracts,
  connectContracts,
} from '@semiotic-labs/tap-contracts-bindings'
import { toAddress } from '@graphprotocol/common-ts'
import { Allocation, QueryFeeModels, TransactionManager, specification as spec } from '..'
function createAllocation(id: string, indexer: string): Allocation {
  const subgraphDeploymentID = new SubgraphDeploymentID('mock-deployment-id')
  const mockSubgraphDeployment: SubgraphDeployment = {
    id: subgraphDeploymentID,
    deniedAt: Date.now(),
    stakedTokens: BigNumber.from('1000'),
    signalledTokens: BigNumber.from('500'),
    queryFeesAmount: BigNumber.from('200'),
    protocolNetwork: 'mainnet',
  }
  return {
    id: toAddress(`0x${id}`),
    status: AllocationStatus.ACTIVE,
    subgraphDeployment: mockSubgraphDeployment,
    indexer: toAddress(`0x${indexer}`),
    allocatedTokens: BigNumber.from(1000),
    createdAtEpoch: 1,
    createdAtBlockHash: '',
    closedAtEpoch: 1,
    closedAtEpochStartBlockHash: '',
    previousEpochStartBlockHash: '',
    closedAtBlockHash: '',
    poi: '',
    queryFeeRebates: BigNumber.from(1000),
    queryFeesCollected: BigNumber.from(1000),
  }
}
// const histogramConfig = {
//   name: 'test_histogram',
//   help: 'Histogram for testing purposes',
//   labelNames: ['label1', 'label2'],
//   buckets: [0.1, 5, 15, 50, 100, 500],
// }
//const mockHistogram = new Histogram<string>(histogramConfig)

describe('AllocationReceiptCollector', () => {
  let mockLogger: Logger
  let mockMetrics: Metrics
  let transactionManager: TransactionManager
  let escrowContracts: EscrowContracts
  let paused: Eventual<boolean>
  let isOperator: Eventual<boolean>
  let mockModel: QueryFeeModels
  let allocation: Allocation
  let mockAllocationExchange: Contract
  let networkSpecification: spec.NetworkSpecification
  let allocations: Eventual<Allocation[]>
  const TAPVerifierAddress = '0x995629b19667Ae71483DC812c1B5a35fCaaAF4B8'
  const escrowAddress = '0x94dFeceb91678ec912ef8f14c72721c102ed2Df7'
  const indexerAddress = '0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b' //<--receiver
  //const gatewayAddress = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
  const allocationID = '0x3fD652C93dFA333979ad762Cf581Df89BaBa6795'
  const allocationIDTrkrAddress = '0x25AF99b922857C37282f578F428CB7f34335B379'
  const rpc_url = 'localhost:8545'
  const chainId = 1337

  beforeEach(async () => {
    const provider = new providers.JsonRpcProvider()

    const { allocationIDTracker, escrow, tapVerifier } = await connectContracts(
      provider,
      chainId,
      {
        [chainId]: {
          TAPVerifier: TAPVerifierAddress,
          AllocationIDTracker: allocationIDTrkrAddress,
          Escrow: escrowAddress,
        },
      },
    )

    allocation = createAllocation(allocationID, indexerAddress)
    const specification: TransactionMonitoring = {
      gasIncreaseTimeout: 240,
      gasIncreaseFactor: 1.2,
      gasPriceMax: 50000,
      maxTransactionAttempts: 3,
    }
    const existingAllocations: Allocation[] = [allocation]

    allocations = new EventualValue(existingAllocations)

    networkSpecification.networkIdentifier = '' // <-- Whats this
    networkSpecification.gateway = Gateway.parse({
      url: rpc_url, // <-- Url is it rpc url too?
    })
    networkSpecification.indexerOptions = IndexerOptions.parse({
      mnemonic:
        'myth like bonus scare over problem client lizard pioneer submit female collect',
      url: rpc_url, // <-- Url is it rpc url too?
    })

    const wallet = new Wallet(
      '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c', // <--
      provider,
    ) // <-- Is this the Gateway PK?

    mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as Logger

    mockMetrics = {
      ravsRedeemDuration: {
        startTimer: jest.fn(() => jest.fn()),
      },
      invalidRavRedeems: {
        inc: jest.fn(),
      },
      ravCollectedFees: {
        set: jest.fn(),
      },
      failedRavRedeems: {
        inc: jest.fn(),
      },
    } as unknown as Metrics

    transactionManager = new TransactionManager(
      provider,
      wallet,
      paused,
      isOperator,
      specification,
    )
    // const collectorOptions = {
    //   logger: mockLogger,
    //   metrics: mockMetrics,
    //   transactionManager: transactionManager,
    //   models: mockModel,
    //   allocationExchange: mockAllocationExchange,
    //   escrowContracts: escrowContracts,
    //   allocations: allocations,
    //   networkSpecification: specification,
    // }
  })

  it('should log an error if escrow contracts are undefined', async () => {
    const signedRavs = [
      {
        message: {
          allocationId: allocationID,
          timestampNs: 123,
          valueAggregate: 5,
        },
        signature: '',
      },
    ]
    try {
      const collector = await AllocationReceiptCollector.create({
        logger: mockLogger,
        metrics: mockMetrics,
        transactionManager: transactionManager,
        models: mockModel,
        allocationExchange: mockAllocationExchange,
        escrowContracts: escrowContracts,
        allocations: allocations,
        networkSpecification: networkSpecification,
      })

      await (collector as any).submitRAVs(signedRavs)
    } catch (error) {
      console.error('Error creating AllocationReceiptCollector:', error)
    }

    // Check if the error logging method was called
    expect(mockLogger.error).toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signedRavs }),
    )
  })

  // ... other test cases
})
