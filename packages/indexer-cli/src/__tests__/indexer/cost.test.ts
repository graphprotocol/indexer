import {
  cliTest,
  teardown,
  connect,
  deleteFromAllTables,
  seedCostModels,
  setupSingleNetwork,
  setupMultiNetworks,
} from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')

describe('Indexer cost tests singleNetwork', () => {
  describe('With indexer management server', () => {
    beforeAll(setupSingleNetwork)
    afterAll(teardown)
    beforeEach(seedCostModels)
    afterEach(deleteFromAllTables)
    describe('Cost help', () => {
      cliTest('Indexer cost', ['indexer', 'cost'], 'references/indexer-cost', {
        expectedExitCode: 255,
        cwd: baseDir,
        timeout: 10000,
      })
      cliTest(
        'Indexer cost help',
        ['indexer', 'cost', '--help'],
        'references/indexer-cost',
        {
          expectedExitCode: 255,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Cost set...', () => {
      cliTest(
        'Indexer cost set model deployment id - success',
        [
          'indexer',
          'cost',
          'set',
          'model',
          'QmXRpJW3qBuYaiBYHdhv8DF4bHDZhXBmh91MtrnhJfQ5Lk',
          'references/basic.agora',
        ],
        'references/indexer-cost-model-deployment',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost set variable deployment id - success',
        [
          'indexer',
          'cost',
          'set',
          'variables',
          'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
          `'{"DAI": "0.5"}'`,
        ],
        'references/indexer-cost-variables-deployment',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost set model deployment id - no arg',
        [
          'indexer',
          'cost',
          'set',
          'model',
          'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
        ],
        'references/indexer-cost-set-no-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost set model subgraph id - wrong type',
        [
          'indexer',
          'cost',
          'set',
          'model',
          '0x0000000000000000000000000000000000000000-0',
          'references/basic.agora',
        ],
        'references/indexer-cost-command-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Cost get...', () => {
      cliTest(
        'Indexer cost get deployment - success',
        ['indexer', 'cost', 'get', 'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt'],
        'references/indexer-cost-variables-deployment',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost get deployment model - success',
        [
          'indexer',
          'cost',
          'get',
          'model',
          'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
        ],
        'references/indexer-cost-deployment-model-only',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost get deployment variables - success',
        [
          'indexer',
          'cost',
          'get',
          'variables',
          'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
        ],
        'references/indexer-cost-deployment-variables-only',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost get all - success',
        ['indexer', 'cost', 'get', 'all'],
        'references/indexer-cost-all',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 15000,
        },
      )
      cliTest(
        'Indexer cost get non-existing cost model - fallback success',
        ['indexer', 'cost', 'get', 'QmVqMeQUwvQ3XjzCYiMhRvQjRiQLGpVt8C3oHgvDi3agJ2'],
        'references/indexer-cost-fallback-global',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 15000,
        },
      )
      cliTest(
        'Indexer cost get - no args',
        ['indexer', 'cost', 'get'],
        'references/indexer-cost-get-no-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer cost get - invalid type of ID',
        ['indexer', 'cost', 'get', '0x0000000000000000000000000000000000000000-0'],
        'references/indexer-cost-command-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })
  })

  describe('Without indexer management server', () => {
    beforeAll(connect)
    cliTest(
      'Indexer cost set - not connected',
      [
        'indexer',
        'cost',
        'set',
        'model',
        'QmXRpJW3qBuYaiBYHdhv8DF4bHDZhXBmh91MtrnhJfQ5Lk',
        'references/basic.agora',
      ],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer cost get - no args',
      ['indexer', 'cost', 'get'],
      'references/indexer-cost-get-no-arg',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer cost get - not connected',
      ['indexer', 'cost', 'get', 'QmXRpJW3qBuYaiBYHdhv8DF4bHDZhXBmh91MtrnhJfQ5Lk'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
  })
})

describe('Indexer cost tests multiNetworks', () => {
  beforeAll(setupMultiNetworks)
  afterAll(teardown)
  beforeEach(seedCostModels)
  afterEach(deleteFromAllTables)

  describe('Cost set...', () => {
    cliTest(
      'Indexer cost set model deployment id - reject multinetwork mode',
      [
        'indexer',
        'cost',
        'set',
        'model',
        'QmXRpJW3qBuYaiBYHdhv8DF4bHDZhXBmh91MtrnhJfQ5Lk',
        'references/basic.agora',
      ],
      'references/indexer-cost-model-deployment-multinetworks',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer cost set variable deployment id - reject multinetwork mode',
      [
        'indexer',
        'cost',
        'set',
        'variables',
        'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
        `'{"DAI": "0.5"}'`,
      ],
      'references/indexer-cost-variables-deployment-multinetworks',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
  })
})
