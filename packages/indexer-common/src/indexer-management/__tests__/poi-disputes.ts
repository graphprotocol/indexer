import { Sequelize } from 'sequelize/types'
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
  IndexerManagementDefaults,
  IndexerManagementFeatures,
} from '../client'
import { defineIndexerManagementModels, IndexerManagementModels } from '../models'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any

const STORE_POI_DISPUTES_MUTATION = gql`
  mutation storeDisputes($disputes: [POIDisputeInput!]!) {
    storeDisputes(disputes: $disputes) {
      allocationID
      allocationIndexer
      allocationAmount
      allocationProof
      allocationClosedBlockHash
      indexerProof
      status
    }
  }
`

const GET_POI_DISPUTE_QUERY = gql`
  query dispute($allocationID: String!) {
    dispute(allocationID: $allocationID) {
      allocationID
      allocationIndexer
      allocationAmount
      allocationProof
      allocationClosedBlockHash
      indexerProof
      status
    }
  }
`

const GET_POI_DISPUTES_QUERY = gql`
  query disputes {
    disputes {
      allocationID
      allocationIndexer
      allocationAmount
      allocationProof
      allocationClosedBlockHash
      indexerProof
      status
    }
  }
`

const DELETE_POI_DISPUTES_QUERY = gql`
  mutation deleteDisputes($allocationIDs: [String!]!) {
    deleteDisputes(allocationIDs: $allocationIDs)
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let address: string
let contracts: NetworkContracts
let logger: Logger

const defaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
  },
} as IndexerManagementDefaults

const features: IndexerManagementFeatures = {
  injectDai: true,
}

const setup = async () => {
  // Spin up db
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  address = '0xtest'
  contracts = await connectContracts(ethers.getDefaultProvider('rinkeby'), 4)
  await sequelize.sync({ force: true })
  logger = createLogger({ name: 'Indexer API Client', level: 'trace' })
}

const teardown = async () => {
  await sequelize.drop({})
}

describe('POI disputes', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('Store POI dispute', async () => {
    const dispute = {
      allocationID: '0x0000000000000000000000000000000000000000',
      allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
      allocationAmount: '100',
      allocationProof:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      allocationClosedBlockHash:
        '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
      indexerProof: '0x0000000000000000000000000000000000000000000000000000000000000000',
      status: 'Closed',
    }
    const expected = { ...dispute }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await expect(
      client
        .mutation(STORE_POI_DISPUTES_MUTATION, {
          disputes: [dispute],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.storeDisputes', [expected])
  })

  test('Get non-existent dispute', async () => {
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await expect(
      client
        .query(GET_POI_DISPUTE_QUERY, {
          allocationID: '0x0000000000000000000000000000000000000001',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.dispute', null)
  })

  test('Get one dispute at a time', async () => {
    const disputes = [
      {
        allocationID: '0x0000000000000000000000000000000000000001',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
      {
        allocationID: '0x0000000000000000000000000000000000000002',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    for (const dispute of disputes) {
      await expect(
        client
          .query(GET_POI_DISPUTE_QUERY, { allocationID: dispute.allocationID })
          .toPromise(),
      ).resolves.toHaveProperty('data.dispute', dispute)
    }
  })

  test('Get all disputes', async () => {
    const disputes = [
      {
        allocationID: '0x0000000000000000000000000000000000000000',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
      {
        allocationID: '0x0000000000000000000000000000000000000001',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client.query(GET_POI_DISPUTES_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })

  test('Remove dispute from store', async () => {
    const disputes = [
      {
        allocationID: '0x0000000000000000000000000000000000000000',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
      {
        allocationID: '0x0000000000000000000000000000000000000001',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .mutation(DELETE_POI_DISPUTES_QUERY, {
          allocationIDs: ['0x0000000000000000000000000000000000000001'],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 1)
    disputes.splice(1, 1)

    await expect(
      client.query(GET_POI_DISPUTES_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })

  test('Remove multiple disputes from store', async () => {
    const disputes = [
      {
        allocationID: '0x0000000000000000000000000000000000000000',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
      {
        allocationID: '0x0000000000000000000000000000000000000001',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
      {
        allocationID: '0x0000000000000000000000000000000000000002',
        allocationIndexer: '0xCOFFEECOFFEECOFFEECOFFEECOFFEECOFFEECOFF',
        allocationAmount: '100',
        allocationProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        allocationClosedBlockHash:
          '0xd75c26ba1134debe856894debe64e0aad9f6eb61289af648f07113fd868c23a0',
        indexerProof:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'Closed',
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    await client.mutation(STORE_POI_DISPUTES_MUTATION, { disputes: disputes }).toPromise()

    await expect(
      client
        .mutation(DELETE_POI_DISPUTES_QUERY, {
          allocationIDs: [
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
          ],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteDisputes', 2)
    disputes.splice(1, 2)

    await expect(
      client.query(GET_POI_DISPUTES_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.disputes', disputes)
  })
})
