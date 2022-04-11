import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import { ethers } from 'ethers'
import {
  connectDatabase,
  connectContracts,
  createLogger,
  Logger,
  NetworkContracts,
  parseGRT,
} from '@graphprotocol/common-ts'

import {
  createIndexerManagementClient,
  IndexerManagementClient,
  IndexerManagementDefaults,
} from '../client'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  POIDisputeAttributes,
} from '../models'
import { IndexingStatusResolver, NetworkSubgraph } from '@graphprotocol/indexer-common'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any

const STORE_POI_DISPUTES_MUTATION = gql`
  mutation storeDisputes($disputes: [POIDisputeInput!]!) {
    storeDisputes(disputes: $disputes) {
      allocationID
      subgraphDeploymentID
      allocationIndexer
      allocationAmount
      allocationProof
      closedEpoch
      closedEpochStartBlockHash
      closedEpochStartBlockNumber
      closedEpochReferenceProof
      previousEpochStartBlockHash
      previousEpochStartBlockNumber
      previousEpochReferenceProof
      status
    }
  }
`

const GET_POI_DISPUTE_QUERY = gql`
  query dispute($allocationID: String!) {
    dispute(allocationID: $allocationID) {
      allocationID
      subgraphDeploymentID
      allocationIndexer
      allocationAmount
      allocationProof
      closedEpoch
      closedEpochStartBlockHash
      closedEpochStartBlockNumber
      closedEpochReferenceProof
      previousEpochStartBlockHash
      previousEpochStartBlockNumber
      previousEpochReferenceProof
      status
    }
  }
`

const GET_POI_DISPUTES_QUERY = gql`
  query disputes($status: String!, $minClosedEpoch: Int!) {
    disputes(status: $status, minClosedEpoch: $minClosedEpoch) {
      allocationID
      subgraphDeploymentID
      allocationIndexer
      allocationAmount
      allocationProof
      closedEpoch
      closedEpochStartBlockHash
      closedEpochStartBlockNumber
      closedEpochReferenceProof
      previousEpochStartBlockHash
      previousEpochStartBlockNumber
      previousEpochReferenceProof
      status
    }
  }
`

const DELETE_POI_DISPUTES_QUERY = gql`
  mutation deleteDisputes($allocationIDs: [String!]!) {
    deleteDisputes(allocationIDs: $allocationIDs)
  }
`

const TEST_DISPUTE_1: POIDisputeAttributes = {
  allocationID: '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
  subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '500000000000000000000000',
  allocationProof: '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
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
  subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '500000000000000000000000',
  allocationProof: '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
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

const TEST_DISPUTE_3: POIDisputeAttributes = {
  allocationID: '0x0000000000000000000000000000000000000002',
  subgraphDeploymentID: 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF',
  allocationIndexer: '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55',
  allocationAmount: '500000000000000000000000',
  allocationProof: '0xdb5b142ba36abbd98d41ebe627d96e7fffb8d79a3f2f25c70a9724e6cdc39ad4',
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

const TEST_DISPUTES_ARRAY = [TEST_DISPUTE_1, TEST_DISPUTE_2]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toObject(dispute: POIDisputeAttributes): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expected: Record<string, any> = Object.assign({}, dispute)
  expected.allocationAmount = expected.allocationAmount.toString()
  return expected
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toObjectArray(disputes: POIDisputeAttributes[]): Record<string, any>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expected: Record<string, any>[] = []
  disputes.forEach((dispute) => {
    expected.push(toObject(dispute))
  })
  return expected
}

let sequelize: Sequelize
let models: IndexerManagementModels
let address: string
let contracts: NetworkContracts
let logger: Logger
let indexingStatusResolver: IndexingStatusResolver
let networkSubgraph: NetworkSubgraph
let client: IndexerManagementClient

const defaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
  },
} as IndexerManagementDefaults

const setup = async () => {
  // Spin up db
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  address = '0xtest'
  contracts = await connectContracts(ethers.getDefaultProvider('rinkeby'), 4)
  await sequelize.sync({ force: true })
  logger = createLogger({ name: 'POI dispute tests', level: 'trace' })
  const statusEndpoint = 'http://localhost:8030/graphql'
  indexingStatusResolver = new IndexingStatusResolver({
    logger: logger,
    statusEndpoint,
  })
  networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint: 'https://gateway.testnet.thegraph.com/network',
    deployment: undefined,
  })
  const indexNodeIDs = ['node_1']
  client = await createIndexerManagementClient({
    models,
    address,
    contracts,
    indexingStatusResolver,
    indexNodeIDs,
    networkSubgraph,
    deploymentManagementEndpoint: statusEndpoint,
    logger,
    defaults,
    features: {
      injectDai: true,
    },
  })
}

const teardown = async () => {
  await sequelize.drop({})
}

describe('POI disputes', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('Store POI disputes', async () => {
    const disputes = TEST_DISPUTES_ARRAY
    const expected = toObjectArray(disputes)

    await expect(
      client
        .mutation(STORE_POI_DISPUTES_MUTATION, {
          disputes: disputes,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.storeDisputes', expected)
  })

  test('Get non-existent dispute', async () => {
    await expect(
      client
        .query(GET_POI_DISPUTE_QUERY, {
          allocationID: '0x0000000000000000000000000000000000000001',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.dispute', null)
  })

  test('Get one dispute at a time', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    for (const dispute of disputes) {
      await expect(
        client
          .query(GET_POI_DISPUTE_QUERY, { allocationID: dispute.allocationID })
          .toPromise(),
      ).resolves.toHaveProperty('data.dispute', dispute)
    }
  })

  test('Get all potential disputes', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, { status: 'potential', minClosedEpoch: 0 })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })

  test('Get disputes with closed epoch greater than', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, { status: 'potential', minClosedEpoch: 205 })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', [TEST_DISPUTE_2])
  })

  test('Remove dispute from store', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .mutation(DELETE_POI_DISPUTES_QUERY, {
          allocationIDs: ['0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C'],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 1)
    disputes.splice(0, 1)

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, { status: 'potential', minClosedEpoch: 0 })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })

  test('Remove multiple disputes from store', async () => {
    const disputes = [TEST_DISPUTE_1, TEST_DISPUTE_2, TEST_DISPUTE_3]

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .mutation(DELETE_POI_DISPUTES_QUERY, {
          allocationIDs: [
            '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
            '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
          ],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 2)
    disputes.splice(0, 2)

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, { status: 'potential', minClosedEpoch: 0 })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })
})
