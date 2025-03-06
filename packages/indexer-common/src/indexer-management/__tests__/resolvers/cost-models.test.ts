import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import {
  createLogger,
  Logger,
  connectDatabase,
  createMetrics,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '../../client'
import { defineIndexerManagementModels, IndexerManagementModels } from '../../models'
import { CombinedError } from '@urql/core'
import { GraphQLError } from 'graphql'
import { createTestManagementClient } from '../util'
import { defineQueryFeeModels } from '../../../query-fees/models'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

const SET_COST_MODEL_MUTATION = gql`
  mutation setCostModel($costModel: CostModelInput!) {
    setCostModel(costModel: $costModel) {
      deployment
      model
    }
  }
`

const DELETE_COST_MODELS_MUTATION = gql`
  mutation deleteCostModels($deployments: [String!]!) {
    deleteCostModels(deployments: $deployments) {
      deployment
      model
    }
  }
`

const GET_COST_MODEL_QUERY = gql`
  query costModel($deployment: String!) {
    costModel(deployment: $deployment) {
      deployment
      model
    }
  }
`

const GET_COST_MODELS_QUERY = gql`
  {
    costModels {
      deployment
      model
    }
  }
`

const GET_COST_MODELS_DEPLOYMENTS_QUERY = gql`
  query costModels($deployments: [String!]) {
    costModels(deployments: $deployments) {
      deployment
      model
    }
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let logger: Logger
let client: IndexerManagementClient
const metrics = createMetrics()

const setupAll = async () => {
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })

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

  client = await createTestManagementClient(
    __DATABASE__,
    logger,
    metrics,
    'eip155:1', // Override with mainnet to enable the Cost Model feature
  )
}

const teardownAll = async () => {
  await sequelize.drop({})
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

describe('Cost models', () => {
  jest.setTimeout(60_000)
  beforeAll(setupAll)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  test('Set and get cost model (model and variables)', async () => {
    const input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'default => 42;',
    }

    const expected = { ...input }

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
      model: 'default => 0.00025;',
    }

    const expected = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: input.model,
    }

    await expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Set, get, and delete global cost model', async () => {
    const input = {
      deployment: 'global',
      model: 'default => 0.00025;',
    }

    const expected = { ...input }

    await expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    //Double check
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment: 'global',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', expected)

    //Check non-existent
    const expectFallback = expected
    expectFallback.deployment = 'blah'
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment: 'blah',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', expected)

    //Delete global cost model
    await expect(
      client
        .mutation(DELETE_COST_MODELS_MUTATION, {
          deployments: [input.deployment],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteCostModels', 1)

    //Check non-existent without global cost model
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment: 'blah',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', null)
  })

  test('Update existing cost model', async () => {
    const deployment =
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    const updates = [
      {
        input: {
          deployment,
          model: 'default => 42;',
        },
        expected: {
          deployment,
          model: 'default => 42;',
        },
      },
      {
        input: {
          deployment,
          model: 'default => 1;',
        },
        expected: {
          deployment,
          model: 'default => 1;',
        },
      },
    ]

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
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', null)
  })

  test('Get non-existent model when global model set', async () => {
    const deployment = 'QmTBxvMF6YnbT1eYeRx9XQpH4WvxTV53vdptCCZFiZSprg'
    // Model doesn't exist when global is not set
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', null)

    // Set global model
    const input = {
      deployment: 'global',
      model: 'default => 0.00025;',
    }

    const expected = { ...input }

    // Global model set
    await expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    // Global fallback to non-existent model
    const expectFallback = expected
    expectFallback.deployment = deployment
    await expect(
      client
        .query(GET_COST_MODEL_QUERY, {
          deployment,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModel', expectFallback)
  })

  test('Get one cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 42;',
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'default => 1;',
      },
    ]

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    for (const input of inputs) {
      await expect(
        client.query(GET_COST_MODEL_QUERY, { deployment: input.deployment }).toPromise(),
      ).resolves.toHaveProperty('data.costModel', input)
    }
  })

  test('Get all cost models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 42;',
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'default => 1;',
      },
    ]

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    await expect(
      client.query(GET_COST_MODELS_QUERY, undefined).toPromise(),
    ).resolves.toHaveProperty('data.costModels', inputs)
  })

  test('Get cost models with defined global models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 2;',
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'default => 1;',
      },
    ]
    const nonexisting =
      '0x2222222222222222222222222222222222222222222222222222222222222222'

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    // only defined cost models are returned
    await expect(
      client
        .query(GET_COST_MODELS_DEPLOYMENTS_QUERY, {
          deployments: inputs.map((model) => model.deployment).concat([nonexisting]),
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModels', inputs)

    // Set global model
    const global_input = {
      deployment: 'global',
      model: 'default => 0.00025;',
    }
    const expected = { ...global_input }
    await expect(
      client
        .mutation(SET_COST_MODEL_MUTATION, {
          costModel: global_input,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    // Global fallback
    global_input.deployment = nonexisting
    await expect(
      client
        .query(GET_COST_MODELS_DEPLOYMENTS_QUERY, {
          deployments: inputs.map((model) => model.deployment).concat([nonexisting]),
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.costModels', inputs.concat([global_input]))
  })

  test('Delete one cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 0.1;',
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'default => 1;',
      },
    ]

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    for (const input of inputs) {
      await expect(
        client.query(GET_COST_MODEL_QUERY, { deployment: input.deployment }).toPromise(),
      ).resolves.toHaveProperty('data.costModel', input)
    }

    for (const input of inputs) {
      await expect(
        client
          .mutation(DELETE_COST_MODELS_MUTATION, { deployments: [input.deployment] })
          .toPromise(),
      ).resolves.toHaveProperty('data.deleteCostModels', 1)
    }
  })

  test('Delete all costs model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 1;',
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'default => 2;',
      },
    ]

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    for (const input of inputs) {
      await expect(
        client.query(GET_COST_MODEL_QUERY, { deployment: input.deployment }).toPromise(),
      ).resolves.toHaveProperty('data.costModel', input)
    }

    await expect(
      client
        .mutation(DELETE_COST_MODELS_MUTATION, {
          deployments: inputs.map((d) => d.deployment),
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteCostModels', 2)
  })

  test('Delete global costs model', async () => {
    const inputs = [
      {
        deployment: 'global',
        model: 'default => 0.00025;',
      },
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'default => 1;',
      },
    ]

    for (const input of inputs) {
      await client.mutation(SET_COST_MODEL_MUTATION, { costModel: input }).toPromise()
    }

    await expect(
      client
        .mutation(DELETE_COST_MODELS_MUTATION, {
          deployments: inputs.map((d) => d.deployment),
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteCostModels', 2)
  })
})

describe('Cost model validation', () => {
  test('Invalid cost models are rejected', async () => {
    const costModel = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'default => 1.0', // semicolon missing
    }

    await expect(
      client.mutation(SET_COST_MODEL_MUTATION, { costModel }).toPromise(),
    ).resolves.toHaveProperty(
      'error',
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            'Invalid cost model: Cost model must be of the form "default => x;", where x is a literal value.',
          ),
        ],
      }),
    )
  })
})
