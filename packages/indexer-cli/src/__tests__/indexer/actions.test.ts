import {
  cliTest,
  deleteFromAllTables,
  seedActions,
  setupSingleNetwork,
  teardown,
} from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')
describe('Indexer actions tests', () => {
  describe('With indexer management server', () => {
    beforeAll(setupSingleNetwork)
    afterAll(teardown)
    beforeEach(seedActions)
    afterEach(deleteFromAllTables)
    describe('Actions help', () => {
      cliTest('Indexer actions', ['indexer', 'actions'], 'references/indexer-actions', {
        expectedExitCode: 255,
        cwd: baseDir,
        timeout: 10000,
      })
      cliTest(
        'Indexer actions help',
        ['indexer', 'actions', '--help'],
        'references/indexer-actions',
        {
          expectedExitCode: 255,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })
    describe('Actions queue', () => {
      cliTest(
        'Indexer actions get',
        ['indexer', 'actions', 'get', 'all'],
        'references/indexer-actions-get',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer actions get - fields',
        ['indexer', 'actions', 'get', 'all', '--fields', 'id,type,deploymentID,status'],
        'references/indexer-actions-get-fields',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer actions get - first',
        ['indexer', 'actions', 'get', '--first', '1'],
        'references/indexer-actions-get-first',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer actions get - first + fields',
        [
          'indexer',
          'actions',
          'get',
          '--first',
          '1',
          '--fields',
          'id,type,deploymentID,status',
        ],
        'references/indexer-actions-get-first-fields',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })
  })
})
