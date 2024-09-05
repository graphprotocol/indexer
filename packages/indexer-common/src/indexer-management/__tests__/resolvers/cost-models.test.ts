import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import {
  createLogger,
  Logger,
  connectDatabase,
  createMetrics,
} from '@graphprotocol/common-ts'
import { defineIndexerManagementModels, IndexerManagementModels } from '../../models'
import { createTestManagementClient } from '../util'
import { defineQueryFeeModels } from '../../../query-fees/models'
import { buildHTTPExecutor } from '@graphql-tools/executor-http'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never

const SET_COST_MODEL_MUTATION = gql`
  mutation setCostModel($costModel: CostModelInput!) {
    setCostModel(costModel: $costModel) {
      deployment
      model
      variables
    }
  }
`

const DELETE_COST_MODELS_MUTATION = gql`
  mutation deleteCostModels($deployments: [String!]!) {
    deleteCostModels(deployments: $deployments)
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

const GET_COST_MODELS_DEPLOYMENTS_QUERY = gql`
  query costModels($deployments: [String!]) {
    costModels(deployments: $deployments) {
      deployment
      model
      variables
    }
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let logger: Logger
let executor: ReturnType<typeof buildHTTPExecutor>
const metrics = createMetrics()
let setDai: (dai: string) => Promise<void>

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

  const client = await createTestManagementClient(
    __DATABASE__,
    logger,
    true,
    metrics,
    'eip155:1', // Override with mainnet to enable the Cost Model feature
  )

  setDai = client.setDai
  executor = buildHTTPExecutor({
    fetch: client.yoga.fetch,
  })
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
      model: 'query { votes } => 10 * $n;',
      variables: JSON.stringify({ n: 100 }),
    }

    const expected = { ...input }

    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      }),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Set and get cost model (model only)', async () => {
    const input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n;',
    }

    const expected = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: input.model,
      variables: null,
    }

    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: {
          costModel: input,
        },
      }),
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

    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: {
          costModel: input,
        },
      }),
    ).resolves.toHaveProperty('data.setCostModel', expected)
  })

  test('Set, get, and delete global cost model', async () => {
    const input = {
      deployment: 'global',
      model: 'default => 0.00025;',
      variables: JSON.stringify({ n: 100 }),
    }

    const expected = { ...input }

    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      }),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    //Double check
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: {
          deployment: 'global',
        },
      }),
    ).resolves.toHaveProperty('data.costModel', expected)

    //Check non-existent
    const expectFallback = expected
    expectFallback.deployment = 'blah'
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: {
          deployment: 'blah',
        },
      }),
    ).resolves.toHaveProperty('data.costModel', expected)

    //Delete global cost model
    await expect(
      executor({
        document: DELETE_COST_MODELS_MUTATION,
        variables: {
          deployments: [input.deployment],
        },
      }),
    ).resolves.toHaveProperty('data.deleteCostModels', 1)

    //Check non-existent without global cost model
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: { deployment: 'blah' },
      }),
    ).resolves.toHaveProperty('data.costModel', null)
  })

  test('Update existing cost model', async () => {
    const deployment =
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    const updates = [
      {
        input: {
          deployment,
          model: 'query { votes} => 10 * $n;',
        },
        expected: {
          deployment,
          model: 'query { votes} => 10 * $n;',
          variables: null,
        },
      },
      {
        input: {
          deployment,
          model: 'query { votes} => 20 * $n;',
        },
        expected: {
          deployment,
          model: 'query { votes} => 20 * $n;',
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
          model: 'query { votes} => 20 * $n;',
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
          model: 'query { votes} => 20 * $n;',
          variables: JSON.stringify({ n: 2 }),
        },
      },
    ]

    for (const update of updates) {
      await expect(
        executor({
          document: SET_COST_MODEL_MUTATION,
          variables: {
            costModel: update.input,
          },
        }),
      ).resolves.toHaveProperty('data.setCostModel', update.expected)
    }
  })

  test('Get non-existent model', async () => {
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: {
          deployment:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
        },
      }),
    ).resolves.toHaveProperty('data.costModel', null)
  })

  test('Get non-existent model when global model set', async () => {
    const deployment = 'QmTBxvMF6YnbT1eYeRx9XQpH4WvxTV53vdptCCZFiZSprg'
    // Model doesn't exist when global is not set
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: { deployment },
      }),
    ).resolves.toHaveProperty('data.costModel', null)

    // Set global model
    const input = {
      deployment: 'global',
      model: 'default => 0.00025;',
      variables: JSON.stringify({ n: 100 }),
    }

    const expected = { ...input }

    // Global model set
    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: {
          costModel: input,
        },
      }),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    // Global fallback to non-existent model
    const expectFallback = expected
    expectFallback.deployment = deployment
    await expect(
      executor({
        document: GET_COST_MODEL_QUERY,
        variables: {
          deployment,
        },
      }),
    ).resolves.toHaveProperty('data.costModel', expectFallback)
  })

  test('Get one cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    for (const input of inputs) {
      await expect(
        executor({
          document: GET_COST_MODEL_QUERY,
          variables: { deployment: input.deployment },
        }),
      ).resolves.toHaveProperty('data.costModel', input)
    }
  })

  test('Get all cost models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    await expect(executor({ document: GET_COST_MODELS_QUERY })).resolves.toHaveProperty(
      'data.costModels',
      inputs,
    )
  })

  test('Get cost models with defined global models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]
    const nonexisting =
      '0x2222222222222222222222222222222222222222222222222222222222222222'

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    // only defined cost models are returned
    await expect(
      executor({
        document: GET_COST_MODELS_DEPLOYMENTS_QUERY,
        variables: {
          deployments: inputs.map((model) => model.deployment).concat([nonexisting]),
        },
      }),
    ).resolves.toHaveProperty('data.costModels', inputs)

    // Set global model
    const global_input = {
      deployment: 'global',
      model: 'default => 0.00025;',
      variables: JSON.stringify({ n: 100 }),
    }
    const expected = { ...global_input }
    await expect(
      executor({
        document: SET_COST_MODEL_MUTATION,
        variables: {
          costModel: global_input,
        },
      }),
    ).resolves.toHaveProperty('data.setCostModel', expected)

    // Global fallback
    global_input.deployment = nonexisting
    await expect(
      executor({
        document: GET_COST_MODELS_DEPLOYMENTS_QUERY,
        variables: {
          deployments: inputs.map((model) => model.deployment).concat([nonexisting]),
        },
      }),
    ).resolves.toHaveProperty('data.costModels', inputs.concat([global_input]))
  })

  test('Clear model by passing in an empty model', async () => {
    let input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n',
      variables: JSON.stringify({ n: 100 }),
    }

    await executor({ document: SET_COST_MODEL_MUTATION, variables: { costModel: input } })

    input = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: '',
      variables: JSON.stringify({}),
    }
    const expected = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: null,
      variables: JSON.stringify({}),
    }

    await executor({ document: SET_COST_MODEL_MUTATION, variables: { costModel: input } })

    await expect(executor({ document: GET_COST_MODELS_QUERY })).resolves.toHaveProperty(
      'data.costModels',
      [expected],
    )
  })

  test('Delete one cost model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    for (const input of inputs) {
      await expect(
        executor({
          document: GET_COST_MODEL_QUERY,
          variables: { deployment: input.deployment },
        }),
      ).resolves.toHaveProperty('data.costModel', input)
    }

    for (const input of inputs) {
      await expect(
        executor({
          document: DELETE_COST_MODELS_MUTATION,
          variables: { deployments: [input.deployment] },
        }),
      ).resolves.toHaveProperty('data.deleteCostModels', 1)
    }
  })

  test('Delete all costs model', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    for (const input of inputs) {
      await expect(
        executor({
          document: GET_COST_MODEL_QUERY,
          variables: { deployment: input.deployment },
        }),
      ).resolves.toHaveProperty('data.costModel', input)
    }

    await expect(
      executor({
        document: DELETE_COST_MODELS_MUTATION,
        variables: {
          deployments: inputs.map((d) => d.deployment),
        },
      }),
    ).resolves.toHaveProperty('data.deleteCostModels', 2)
  })

  test('Delete global costs model', async () => {
    const inputs = [
      {
        deployment: 'global',
        model: 'default => 0.00025;',
        variables: JSON.stringify({ n: 100 }),
      },
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    await expect(
      executor({
        document: DELETE_COST_MODELS_MUTATION,
        variables: {
          deployments: inputs.map((d) => d.deployment),
        },
      }),
    ).resolves.toHaveProperty('data.deleteCostModels', 2)
  })
})

describe('Feature: Inject $DAI variable', () => {
  beforeEach(setupAll)
  afterEach(teardownAll)

  test('$DAI variable is preserved when clearing variables', async () => {
    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n;',
      variables: JSON.stringify({ DAI: '10.0' }),
    }
    await executor({
      document: SET_COST_MODEL_MUTATION,
      variables: { costModel: initial },
    })

    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: null,
      variables: JSON.stringify({}),
    }
    await executor({
      document: SET_COST_MODEL_MUTATION,
      variables: { costModel: update },
    })

    await expect(executor({ document: GET_COST_MODELS_QUERY })).resolves.toHaveProperty(
      'data.costModels',
      [initial],
    )
  })

  test('$DAI variable can be overwritten', async () => {
    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n;',
      variables: JSON.stringify({ DAI: '10.0' }),
    }
    await executor({
      variables: { costModel: initial },
      document: SET_COST_MODEL_MUTATION,
    })
    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: initial.model,
      variables: JSON.stringify({ DAI: '15.0' }),
    }
    await executor({
      document: SET_COST_MODEL_MUTATION,
      variables: { costModel: update },
    })
    await expect(
      executor({
        document: GET_COST_MODELS_QUERY,
      }),
    ).resolves.toHaveProperty('data.costModels', [update])
  })

  test('$DAI updates are applied to all cost models', async () => {
    const inputs = [
      {
        deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100, DAI: '10.0' }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    for (const input of inputs) {
      await executor({
        variables: { costModel: input },
        document: SET_COST_MODEL_MUTATION,
      })
    }

    await setDai('15.3')

    await expect(executor({ document: GET_COST_MODELS_QUERY })).resolves.toHaveProperty(
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
        model: 'query { votes } => 10 * $n;',
        variables: JSON.stringify({ n: 100, DAI: '10.0' }),
      },
      {
        deployment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        model: 'query { proposals } => 30 * $n;',
        variables: JSON.stringify({ n: 10 }),
      },
    ]

    // This time, set the DAI value first
    await setDai('15.3')

    // THEN add new cost models
    for (const input of inputs) {
      await executor({
        document: SET_COST_MODEL_MUTATION,
        variables: { costModel: input },
      })
    }

    await expect(
      executor({
        document: GET_COST_MODELS_QUERY,
      }),
    ).resolves.toHaveProperty('data.costModels', [
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
    ])
  })

  test('$DAI is preserved when cost model is updated', async () => {
    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n;',
      variables: JSON.stringify({ n: 5, DAI: '10.0' }),
    }

    await executor({
      document: SET_COST_MODEL_MUTATION,
      variables: { costModel: initial },
    })
    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'default => 1;',
      variables: null,
    }
    await executor({
      document: SET_COST_MODEL_MUTATION,
      variables: { costModel: update },
    })
    await expect(executor({ document: GET_COST_MODELS_QUERY })).resolves.toHaveProperty(
      'data.costModels',
      [
        {
          ...update,
          variables: initial.variables,
        },
      ],
    )
  })

  test('If feature is disabled, $DAI variable is not preserved', async () => {
    const clientNoInjectDai = await createTestManagementClient(
      __DATABASE__,
      logger,
      false,
      metrics,
      'eip155:1', // Override with mainnet to enable the Cost Model feature
    )

    const initial = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'query { votes } => 10 * $n;',
      variables: JSON.stringify({ n: 5, DAI: '10.0' }),
    }

    await buildHTTPExecutor({
      fetch: clientNoInjectDai.yoga.fetch,
    })({ document: SET_COST_MODEL_MUTATION, variables: { costModel: initial } })

    const update = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: initial.model,
      variables: JSON.stringify({}),
    }

    await buildHTTPExecutor({
      fetch: clientNoInjectDai.yoga.fetch,
    })({ document: SET_COST_MODEL_MUTATION, variables: { costModel: update } })
    await expect(
      buildHTTPExecutor({
        fetch: clientNoInjectDai.yoga.fetch,
      })({ document: GET_COST_MODELS_QUERY }),
    ).resolves.toHaveProperty('data.costModels', [update])
  })
})

describe('Cost model validation', () => {
  test('Invalid cost models are rejected', async () => {
    const costModel = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'default => 1.0', // semicolon missing
      variables: '{}',
    }

    await expect(
      executor({ document: SET_COST_MODEL_MUTATION, variables: { costModel } }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['setCostModel'],
        locations: [{ line: 2, column: 3 }],
        message: 'Invalid cost model or variables: Failed to compile cost model',
      },
    ])
  })

  test('Invalid cost model variables are rejected', async () => {
    const costModel = {
      deployment: '0x0000000000000000000000000000000000000000000000000000000000000000',
      model: 'default => 1.0;',
      variables: '"foo"',
    }

    await expect(
      executor({ document: SET_COST_MODEL_MUTATION, variables: { costModel } }),
    ).resolves.toHaveProperty('errors', [
      {
        path: ['setCostModel'],
        locations: [{ line: 2, column: 3 }],
        message: 'Invalid cost model or variables: Failed to compile cost model',
      },
    ])
  })
})
