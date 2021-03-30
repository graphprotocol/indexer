import {
  connectContracts,
  connectDatabase,
  createLogger,
  Logger,
  NetworkContracts,
  parseGRT,
  toAddress,
} from '@graphprotocol/common-ts'
import {
  createIndexerManagementClient,
  defineIndexerManagementModels,
  IndexerManagementClient,
  IndexerManagementModels,
  POIDisputeAttributes,
} from '@graphprotocol/indexer-common'
import { BigNumber, Wallet } from 'ethers'
import { Sequelize } from 'sequelize/types'
import { Indexer } from '../indexer'

const TEST_DISPUTE_1: POIDisputeAttributes = {
  allocationID: '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '500000000000000000000000',
  allocationProof:
    '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
  closedEpoch: 203,
  closedEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  closedEpochStartBlockNumber: 848484,
  closedEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  previousEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  previousEpochStartBlockNumber: 848484,
  previousEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  status: 'potential',
}
const TEST_DISPUTE_2: POIDisputeAttributes = {
  allocationID: '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '5000000',
  allocationProof:
    '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
  closedEpoch: 210,
  closedEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  closedEpochStartBlockNumber: 848484,
  closedEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  previousEpochStartBlockHash:
    '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
  previousEpochStartBlockNumber: 848484,
  previousEpochReferenceProof:
    '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
  status: 'potential',
}

const POI_DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | BigNumber | number | undefined
> = {
  allocationID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => x,
  allocationProof: x => x,
  closedEpoch: x => +x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => +x,
  closedEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => +x,
  previousEpochReferenceProof: x => x,
  status: x => x,
}

/**
 * Parses a POI dispute returned from the indexer management GraphQL
 * API into normalized form.
 */
const disputeFromGraphQL = (
  dispute: Partial<POIDisputeAttributes>,
): POIDisputeAttributes => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(dispute)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (POI_DISPUTES_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as POIDisputeAttributes
}

declare const __DATABASE__: never

let sequelize: Sequelize
let models: IndexerManagementModels
let wallet: Wallet
let address: string
let contracts: NetworkContracts
let logger: Logger
let indexerManagementClient: IndexerManagementClient
let indexer: Indexer

const setup = async () => {
  logger = createLogger({
    name: 'IndexerAgent',
    async: false,
    level: 'trace',
  })

  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  address = '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55'
  contracts = await connectContracts(wallet, 4)
  await sequelize.sync({ force: true })

  wallet = Wallet.createRandom()

  indexerManagementClient = await createIndexerManagementClient({
    models,
    address: toAddress(address),
    contracts: contracts,
    logger,
    defaults: {
      globalIndexingRule: {
        allocationAmount: parseGRT('1000'),
        parallelAllocations: 2,
      },
    },
    features: {
      injectDai: false,
    },
  })

  indexer = new Indexer(
    'test',
    'test',
    indexerManagementClient,
    logger,
    ['test'],
    parseGRT('1000'),
    address,
  )
}

const teardown = async () => {
  await sequelize.drop({})
}

describe('Indexer tests', () => {
  beforeEach(setup)
  afterEach(teardown)

  // test('Parse Dispute from GraphQL', async () => {})
  test('Store POI Disputes rejects invalid indexer address', async () => {
    const badDispute: POIDisputeAttributes = {
      allocationID: '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
      allocationIndexer: '0xCOFFEECOFFEECOFFEE',
      allocationAmount: '500000000',
      allocationProof:
        '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
      closedEpoch: 203,
      closedEpochStartBlockHash:
        '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
      closedEpochStartBlockNumber: 848484,
      closedEpochReferenceProof:
        '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
      previousEpochStartBlockHash:
        '0x675e9411241c431570d07b920321b2ff6aed2359aa8e26109905d34bffd8932a',
      previousEpochStartBlockNumber: 848484,
      previousEpochReferenceProof:
        '0xd04b5601739a1638719696d0735c92439267a89248c6fd21388d9600f5c942f6',
      status: 'potential',
    }

    const disputes = [badDispute]

    await expect(indexer.storePoiDisputes(disputes)).rejects.toThrow(
      'Failed to store pending POI disputes',
    )
  })

  test('Store POI Disputes is idempotent', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedResult = disputes.map((dispute: Record<string, any>) => {
      return disputeFromGraphQL(dispute)
    })
    await expect(indexer.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(indexer.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(indexer.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
  })

  test('Fetch POI Disputes', async () => {
    const disputes: POIDisputeAttributes[] = [TEST_DISPUTE_1, TEST_DISPUTE_2]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedResult = disputes.map((dispute: Record<string, any>) => {
      return disputeFromGraphQL(dispute)
    })
    const expectedFilteredResult = [disputeFromGraphQL(TEST_DISPUTE_2)]
    await expect(indexer.storePoiDisputes(disputes)).resolves.toEqual(
      expectedResult,
    )
    await expect(indexer.fetchPOIDisputes('potential', 205)).resolves.toEqual(
      expectedFilteredResult,
    )
  })
})
