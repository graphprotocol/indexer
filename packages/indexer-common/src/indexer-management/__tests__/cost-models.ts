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
import { Json } from 'sequelize/types/lib/utils'

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

const defaults: IndexerManagementDefaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
    parallelAllocations: 2,
  },
}

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

describe('Cost models', () => {
  beforeEach(setup)
  afterEach(teardown)

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
      defaults,
      features,
    })

    await expect(
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
      defaults,
      features,
    })

    await expect(
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
      variables: `{"baz":5,"foo":"bar"}`,
    }

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
      defaults,
      features,
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
      defaults,
      features,
    })

    await expect(
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
      defaults,
      features,
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
      defaults,
      features,
    })

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    await expect(client.query(GET_COST_MODELS_QUERY).toPromise()).resolves.toHaveProperty(
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
      features,
    })

    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()

    input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '',
      variables: JSON.stringify({}),
    }

    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()

    await expect(
      client.query(GET_COST_MODELS_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.costModels', [input])
  })
})

describe('Feature: Inject $DAI variable', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('$DAI variable is preserved when clearing variables', async () => {
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
      variables: JSON.stringify({ DAI: '10.0' }),
    }
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: initial }).toPromise()

    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: null,
      variables: JSON.stringify({}),
    }
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: update }).toPromise()

    await expect(
      client.query(GET_COST_MODELS_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.costModels', [initial])
  })

  test('$DAI variable can be overwritten', async () => {
    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
      variables: JSON.stringify({ DAI: '10.0' }),
    }
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: initial }).toPromise()
    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: initial.model,
      variables: JSON.stringify({ DAI: '15.0' }),
    }
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: update }).toPromise()
    await expect(
      client.query(GET_COST_MODELS_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.costModels', [update])
  })

  test('$DAI updates are applied to all cost models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: '{ votes } => 10 * $n',
        variables: JSON.stringify({ n: 100, DAI: '10.0' }),
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
      defaults,
      features: {
        injectDai: true,
      },
    })

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    await client.setDai('15.3')

    await expect(client.query(GET_COST_MODELS_QUERY).toPromise()).resolves.toHaveProperty(
      'data.costModels',
      [
        {
          ...inputs[0],
          // DAI was replaced here
          variables: JSON.stringify({ n: 100, DAI: '15.3' }),
        },
        {
          ...inputs[1],
          // DAI was added here
          variables: JSON.stringify({ n: 10, DAI: '15.3' }),
        },
      ],
    )
  })

  test('$DAI is added to new models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: '{ votes } => 10 * $n',
        variables: JSON.stringify({ n: 100, DAI: '10.0' }),
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
      defaults,
      features: {
        injectDai: true,
      },
    })

    // This time, set the DAI value first
    await client.setDai('15.3')

    // THEN add new cost models
    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    await expect(client.query(GET_COST_MODELS_QUERY).toPromise()).resolves.toHaveProperty(
      'data.costModels',
      [
        {
          ...inputs[0],
          // DAI was replaced here
          variables: JSON.stringify({ n: 100, DAI: '15.3' }),
        },
        {
          ...inputs[1],
          // DAI was added here
          variables: JSON.stringify({ n: 10, DAI: '15.3' }),
        },
      ],
    )
  })

  test('If feature is disabled, $DAI variable is not preserved', async () => {
    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '{ votes } => 10 * $n',
      variables: JSON.stringify({ DAI: '10.0' }),
    }
    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features: {
        injectDai: false,
      },
    })
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: initial }).toPromise()
    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: initial.model,
      variables: JSON.stringify({}),
    }
    await client.mutation(SET_COST_MODEL_MUTATION, { costModel: update }).toPromise()
    await expect(
      client.query(GET_COST_MODELS_QUERY).toPromise(),
    ).resolves.toHaveProperty('data.costModels', [update])
  })
})
