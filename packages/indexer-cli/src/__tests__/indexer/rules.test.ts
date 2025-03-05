import {
  cliTest,
  connect,
  teardown,
  deleteFromAllTables,
  seedIndexingRules,
  setupSingleNetwork,
} from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')

describe('Indexer rules tests', () => {
  describe('With indexer management server', () => {
    beforeAll(setupSingleNetwork)
    afterAll(teardown)
    beforeEach(seedIndexingRules)
    afterEach(deleteFromAllTables)
    describe('Rules help', () => {
      cliTest('Indexer rules', ['indexer', 'rules'], 'references/indexer-rules', {
        expectedExitCode: 255,
        cwd: baseDir,
        timeout: 10000,
      })
      cliTest(
        'Indexer rules help',
        ['indexer', 'rules', '--help'],
        'references/indexer-rules',
        {
          expectedExitCode: 255,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules start...', () => {
      cliTest(
        'Indexer rules start - success',
        ['indexer', 'rules', 'start', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-always',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules start - no identifier',
        ['indexer', 'rules', 'start'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules start - invalid deployment ID ',
        ['indexer', 'rules', 'start', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules prepare...', () => {
      cliTest(
        'Indexer rules prepare - success',
        ['indexer', 'rules', 'prepare', 'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK'],
        'references/indexer-rule-deployment-offchain',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules offchain - success',
        [
          'indexer',
          'rules',
          'offchain',
          'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
        ],
        'references/indexer-rule-deployment-offchain',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules prepare - no identifier',
        ['indexer', 'rules', 'prepare'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules prepare - invalid deployment ID ',
        ['indexer', 'rules', 'prepare', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules stop...', () => {
      cliTest(
        'Indexer rules stop - success',
        ['indexer', 'rules', 'stop', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-never',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules stop - no identifier',
        ['indexer', 'rules', 'stop'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules stop - invalid deployment ID',
        ['indexer', 'rules', 'stop', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules maybe...', () => {
      cliTest(
        'Indexer rules maybe - success',
        ['indexer', 'rules', 'maybe', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules maybe - no identifier',
        ['indexer', 'rules', 'maybe'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules maybe - invalid deployment ID ',
        ['indexer', 'rules', 'maybe', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules clear...', () => {
      cliTest(
        'Indexer rules clear - success',
        ['indexer', 'rules', 'clear', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules clear - no identifier',
        ['indexer', 'rules', 'clear'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules clear - invalid deployment ID ',
        ['indexer', 'rules', 'clear', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules delete...', () => {
      cliTest(
        'Indexer rules delete - success',
        ['indexer', 'rules', 'delete', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-deleted-success',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules delete - success',
        ['indexer', 'rules', 'delete', 'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK'],
        'references/indexer-rule-deployment-deleted-offchain-success',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules delete - no identifier',
        ['indexer', 'rules', 'delete'],
        'references/indexer-rules-no-identifier',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules delete - invalid deployment ID ',
        ['indexer', 'rules', 'delete', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules set...', () => {
      cliTest(
        'Indexer rules set subgraph id - success',
        [
          'indexer',
          'rules',
          'set',
          '0x0000000000000000000000000000000000000000-0',
          'allocationAmount',
          '1000',
        ],
        'references/indexer-rule-subgraph-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set subgraph options - success',
        [
          'indexer',
          'rules',
          'set',
          '0x0000000000000000000000000000000000000000-1',
          'allocationAmount',
          '1000',
          'decisionBasis',
          'offchain',
          'allocationLifetime',
          '12',
        ],
        'references/indexer-rule-subgraph-offchain',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set deployment id - success',
        ['indexer', 'rules', 'set', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set deployment id supported - success',
        [
          'indexer',
          'rules',
          'set',
          'QmVEV7RA2U6BJT9Ssjxcfyrk4YQUnVqSRNX4TvYagjzh9h',
          'requireSupported',
          'false',
        ],
        'references/indexer-rule-deployment-supported',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set deployment id safety - success',
        [
          'indexer',
          'rules',
          'set',
          'QmVEV7RA2U6BJT9Ssjxcfyrk4YQUnVqSRNX4TvYagjzh9h',
          'safety',
          'false',
          'requireSupported',
          'true',
        ],
        'references/indexer-rule-deployment-safety',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set deployment id - success - offchain',
        [
          'indexer',
          'rules',
          'set',
          'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
          'decisionBasis',
          'offchain',
          'allocationLifetime',
          '21',
          'autoRenewal',
          'false',
        ],
        'references/indexer-rule-deployment-lifetime',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set global - success',
        [
          'indexer',
          'rules',
          'set',
          'global',
          'minSignal',
          '500',
          'allocationAmount',
          '.01',
        ],
        'references/indexer-rule-global-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set - invalid deployment ID ',
        ['indexer', 'rules', 'set', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules set - invalid arg',
        [
          'indexer',
          'rules',
          'set',
          '0x0000000000000000000000000000000000000000-0',
          'allocationAmoewt',
          '1000',
        ],
        'references/indexer-rules-invalid-set-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules get...', () => {
      cliTest(
        'Indexer rules output format error',
        ['indexer', 'rules', 'get', 'all', '--output', 'josn'],
        'references/indexer-output-format',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get deployment - success',
        ['indexer', 'rules', 'get', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
        'references/indexer-rule-deployment-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get deployment - success - offchain',
        ['indexer', 'rules', 'get', 'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK'],
        'references/indexer-rule-deployment-offchain',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get subgraph - success',
        ['indexer', 'rules', 'get', '0x0000000000000000000000000000000000000000-0'],
        'references/indexer-rule-subgraph-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get subgraph - success - options',
        ['indexer', 'rules', 'get', '0x0000000000000000000000000000000000000000-2'],
        'references/indexer-rule-subgraph-options',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get deployment yaml - success',
        [
          'indexer',
          'rules',
          'get',
          'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q',
          '--output',
          'yaml',
        ],
        'references/indexer-rule-deployment-yaml',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get global - success',
        ['indexer', 'rules', 'get', 'global'],
        'references/indexer-rule-global-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 15000,
        },
      )
      cliTest(
        'Indexer rules get - no args',
        ['indexer', 'rules', 'get'],
        'references/indexer-rules-command-no-args',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules get - invalid deployment ID ',
        ['indexer', 'rules', 'get', 'Qmemememememe'],
        'references/indexer-rules-invalid-identifier-arg',
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
      'Indexer rules start - not connected',
      ['indexer', 'rules', 'start', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules stop - not connected',
      ['indexer', 'rules', 'stop', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules maybe - not connected',
      ['indexer', 'rules', 'maybe', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules get - not connected',
      ['indexer', 'rules', 'get', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules delete - not connected',
      ['indexer', 'rules', 'delete', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules clear - not connected',
      ['indexer', 'rules', 'clear', 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
  })
})
