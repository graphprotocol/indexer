import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import {
  createMetrics,
  connectDatabase,
  createLogger,
  Logger,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '../../client'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  POIDisputeAttributes,
} from '../../models'
import { createTestManagementClient } from '../util'
import { defineQueryFeeModels } from '../../../query-fees/models'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

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
      protocolNetwork
    }
  }
`

const GET_POI_DISPUTE_QUERY = gql`
  query dispute($identifier: POIDisputeIdentifier!) {
    dispute(identifier: $identifier) {
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
      protocolNetwork
    }
  }
`

const GET_POI_DISPUTES_QUERY = gql`
  query disputes($status: String!, $minClosedEpoch: Int!, $protocolNetwork: String!) {
    disputes(
      status: $status
      minClosedEpoch: $minClosedEpoch
      protocolNetwork: $protocolNetwork
    ) {
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
      protocolNetwork
    }
  }
`

const DELETE_POI_DISPUTES_QUERY = gql`
  mutation deleteDisputes($identifiers: [POIDisputeIdentifier!]!) {
    deleteDisputes(identifiers: $identifiers)
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
  protocolNetwork: 'goerli',
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
  protocolNetwork: 'goerli',
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
  protocolNetwork: 'goerli',
}

const TEST_DISPUTES_ARRAY = [TEST_DISPUTE_1, TEST_DISPUTE_2]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toObject(dispute: POIDisputeAttributes): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expected: Record<string, any> = Object.assign({}, dispute)
  expected.allocationAmount = expected.allocationAmount.toString()
  if (expected.protocolNetwork === 'goerli') {
    expected.protocolNetwork = 'eip155:5'
  }
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
let logger: Logger
let client: IndexerManagementClient
const metrics = createMetrics()

const setupAll = async () => {
  // Spin up db
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  client = await createTestManagementClient(__DATABASE__, logger, true, metrics)
  logger.info('Finished setting up Test Indexer Management Client')
}

const setupEach = async () => {
  await sequelize.sync({ force: true })
}
const teardownEach = async () => {
  // Clear out indexer management models
  await models.Action.truncate({ cascade: true })
  await models.CostModel.truncate({ cascade: true })
  await models.IndexingRule.truncate({ cascade: true })
  await models.POIDispute.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
}

describe('POI disputes', () => {
  jest.setTimeout(60_000)
  beforeAll(setupAll)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

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
    const identifier = {
      allocationID: '0x0000000000000000000000000000000000000001',
      protocolNetwork: 'goerli',
    }
    await expect(
      client.query(GET_POI_DISPUTE_QUERY, { identifier }).toPromise(),
    ).resolves.toHaveProperty('data.dispute', null)
  })

  test('Get one dispute at a time', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    for (const dispute of disputes) {
      const identifier = {
        allocationID: dispute.allocationID,
        protocolNetwork: 'eip155:5',
      }
      const expected = { ...dispute, protocolNetwork: 'eip155:5' }
      await expect(
        client.query(GET_POI_DISPUTE_QUERY, { identifier }).toPromise(),
      ).resolves.toHaveProperty('data.dispute', expected)
    }
  })

  test('Get all potential disputes', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    // Once persisted, the protocol network identifier assumes the CAIP2-ID format
    const expected = disputes.map((dispute) => ({
      ...dispute,
      protocolNetwork: 'eip155:5',
    }))

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, {
          status: 'potential',
          minClosedEpoch: 0,
          protocolNetwork: 'goerli',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', expected)
  })

  test('Get disputes with closed epoch greater than', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    // Once persisted, the protocol network identifier assumes the CAIP2-ID format
    const expected = [{ ...TEST_DISPUTE_2, protocolNetwork: 'eip155:5' }]

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, {
          status: 'potential',
          minClosedEpoch: 205,
          protocolNetwork: 'goerli',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', expected)
  })

  test('Remove dispute from store', async () => {
    const disputes = TEST_DISPUTES_ARRAY

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    const identifiers = [
      {
        allocationID: '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
        protocolNetwork: 'goerli',
      },
    ]
    await expect(
      client
        .mutation(DELETE_POI_DISPUTES_QUERY, {
          identifiers,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 1)
    disputes.splice(0, 1)

    // Once persisted, the protocol network identifier assumes the CAIP2-ID format
    const expected = disputes.map((dispute) => ({
      ...dispute,
      protocolNetwork: 'eip155:5',
    }))

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, {
          status: 'potential',
          minClosedEpoch: 0,
          protocolNetwork: 'goerli',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', expected)
  })

  test('Remove multiple disputes from store', async () => {
    const disputes = [TEST_DISPUTE_1, TEST_DISPUTE_2, TEST_DISPUTE_3]

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    const identifiers = [
      {
        allocationID: '0xbAd8935f75903A1eF5ea62199d98Fd7c3c1ab20C',
        protocolNetwork: 'goerli',
      },
      {
        allocationID: '0x085fd2ADc1B96c26c266DecAb6A3098EA0eda619',
        protocolNetwork: 'goerli',
      },
    ]

    await expect(
      client.mutation(DELETE_POI_DISPUTES_QUERY, { identifiers }).toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 2)
    disputes.splice(0, 2)

    // Once persisted, the protocol network identifier assumes the CAIP2-ID format
    const expected = disputes.map((dispute) => ({
      ...dispute,
      protocolNetwork: 'eip155:5',
    }))

    await expect(
      client
        .query(GET_POI_DISPUTES_QUERY, {
          status: 'potential',
          minClosedEpoch: 0,
          protocolNetwork: 'goerli',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.disputes', expected)
  })
})
