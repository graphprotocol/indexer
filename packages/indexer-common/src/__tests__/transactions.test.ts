import { Overrides } from 'ethers'
import {
  connectContracts,
  createLogger,
  createMetrics,
  Logger,
  mutable,
  NetworkContracts,
} from '@graphprotocol/common-ts'
import { connectWallet, Network, TransactionManager } from '@graphprotocol/indexer-common'
import { TransactionMonitoring } from '../network-specification'
import geohash from 'ngeohash'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: never

let contracts: NetworkContracts
let logger: Logger
let transactionManager: TransactionManager

const setup = async () => {
  logger = createLogger({
    name: 'transactions.test.ts',
    async: false,
    level: __LOG_LEVEL__,
  })
  const metrics = createMetrics()
  const provider = await Network.provider(
    logger,
    metrics,
    'arbsepolia',
    // 'https://sepolia.publicgoods.network',
    'https://sepolia-rollup.arbitrum.io/rpc',
    // 'https://wiser-evocative-energy.arbitrum-sepolia.quiknode.pro/fa97af810dfc2e91b4dedecdd381e92a82ef70e3/',
    1000,
  )
  const testPhrase =
    'myth like bonus scare over problem client lizard pioneer submit female collect'
  const wallet = await connectWallet(provider, 'arbsepolia', testPhrase, logger)
  transactionManager = new TransactionManager(
    provider,
    wallet,
    mutable(false),
    mutable(true),
    TransactionMonitoring.parse({}),
  )
  contracts = await connectContracts(wallet, 421614, undefined)
}

describe('Transaction Manager tests', () => {
  beforeAll(setup)

  // Use higher timeout because tests make requests to an open RPC provider
  jest.setTimeout(30_000)

  test('Identify Arbitrum provider', async () => {
    await expect(transactionManager.isArbitrumChain()).resolves.toEqual(true)
  })

  test('Get gas price', async () => {
    const gasP = await transactionManager.ethereum.getFeeData()
    console.log('FeeData', gasP)
    expect(gasP).toEqual(true)
  })

  test('Arbitrum gas estimation', async () => {
    const contractAddress = contracts.serviceRegistry.address
    const txData = await contracts.serviceRegistry.populateTransaction.register(
      'http://testindexer.hi',
      geohash.encode(100, 100),
    )
    const estimatedFee = await transactionManager.arbGasEstimation(
      logger,
      contractAddress,
      txData.data!,
    )
    console.log('ef', estimatedFee)

    const gasP = await transactionManager.ethereum.getFeeData()
    console.log('FeeData', gasP)
    await expect(estimatedFee).toEqual(4)
  })

  test('Estimate gas usage of contract function', async () => {
    const overrides = [
      { maxPriorityFeePerGas: 0 },
      { },
      // { maxPriorityFeePerGas: 0, maxFeePerGas: 100000000 },
    ]
    for (const override of overrides) {
      const gasEstimate = await contracts.serviceRegistry.estimateGas.register(
        'http://testindexer.hi',
        geohash.encode(100, 100),
        override,
      )
      console.log('gasEstimate', gasEstimate.toString())
    }

    await expect(overrides).toEqual({ maxFeePerGas: 0 })
  })

  test('Calculate transaction overrides', async () => {
    const estimationFn = (overrides: Overrides | undefined) =>
      contracts.serviceRegistry.estimateGas.register(
        'http://testindexer.hi',
        geohash.encode(100, 100),
        overrides,
      )

    await expect(transactionManager.txOverrides(estimationFn)).resolves.toHaveProperty('maxPriorityFeePerGas', 0)
  })
})
