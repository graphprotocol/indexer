import { Sequelize } from 'sequelize/types'
import gql from 'graphql-tag'
import { ethers } from 'ethers'
import {
  connectDatabase,
  connectContracts,
  createLogger,
  Logger,
  NetworkContracts,
} from '@graphprotocol/common-ts'

import { createIndexerManagementClient } from '../client'
import { defineIndexerManagementModels, IndexerManagementModels } from '../models'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any

const SET_COST_MODEL_MUTATION = gql`
  mutation setCostModel($costModel: CostModelInput!) {
    setCostModel(costModel: $costModel) {
      deployment
      model
      variables
    }
  }
`

const GET_COST_MODEL_QUERY = gql`
  query costModel($deployment: String!) {
    costModel(deployment: $deployment) {
      deployment
      model
      variables
    }
  }
`

const GET_COST_MODELS_QUERY = gql`
  {
    costModels {
      deployment
      model
      variables
    }
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let address: string
let contracts: NetworkContracts
let logger: Logger

describe('Cost models', () => {
  beforeEach(async () => {
    // Spin up db
    sequelize = await connectDatabase(__DATABASE__)
    models = defineIndexerManagementModels(sequelize)
    address = '0xtest'
    contracts = await connectContracts(ethers.getDefaultProvider('rinkeby'), 4)
    await sequelize.sync({ force: true })
    logger = createLogger({ name: 'Indexer API Client', level: 'trace' })
  })

  afterEach(async () => {
    await sequelize.drop({})
  })

  test('Set and get cost model (model and variables)', async () => {
    const input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
      variables: JSON.stringify({ n: 100 }),
    }

    const expected = { ...input }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Set and get cost model (model only)', async () => {
    const input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
    }

    const expected = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: input.model,
      variables: null,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Set and get cost model (variables only)', async () => {
    const input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      variables: JSON.stringify({ foo: 'bar', baz: 5 }),
    }

    const expected = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: null,
      variables: input.variables,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Update existing cost model', async () => {
    const deployment =
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    const updates = [
      {
        input: {
          deployment,
          model: '{ votes} => 10 * $n',
        },
        expected: {
          deployment,
          model: '{ votes} => 10 * $n',
          variables: null,
        },
      },
      {
        input: {
          deployment,
          model: '{ votes} => 20 * $n',
        },
        expected: {
          deployment,
          model: '{ votes} => 20 * $n',
          variables: null,
        },
      },
      {
        input: {
          deployment,
          variables: JSON.stringify({ n: 1 }),
        },
        expected: {
          deployment,
          model: '{ votes} => 20 * $n',
          variables: JSON.stringify({ n: 1 }),
        },
      },
      {
        input: {
          deployment,
          variables: JSON.stringify({ n: 2 }),
        },
        expected: {
          deployment,
          model: '{ votes} => 20 * $n',
          variables: JSON.stringify({ n: 2 }),
        },
      },
    ]
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    for (const update of updates) {
      await expect(
        client
          .mutation(SET_COST_MODEL_MUTATION, {
            costModel: update.input,
          })
          .toPromise(),
      ).resolves.toHaveProperty('data.setCostModel', update.expected)
    }
  })

  test('Get non-existent model', async () => {
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', null)
  })

  test('Get one cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: '{ votes } => 10 * $n',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: '{ proposals } => 30 * $n',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    for (const input of inputs) {
      await expect(
        client.query(GET_COST_MODEL_QUERY, { deployment: input.deployment }).toPromise(),
      ).resolves.toHaveProperty('data.costModel', input)
    }
  })

  test('Get all cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: '{ votes } => 10 * $n',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: '{ proposals } => 30 * $n',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
    })

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    expect(client.query(GET_COST_MODELS_QUERY).toPromise()).resolves.toHaveProperty(
      'data.costModels',
      inputs,
    )
  })

  test('Clear model by passing in an empty model', async () => {
    let input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
      variables: JSON.stringify({ n: 100 }),
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
    })

    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()

    input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '',
      variables: '{}',
    }

    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()

    expect(
      client.query(GET_COST_MODELS_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.costModels', [input])
  })
})
