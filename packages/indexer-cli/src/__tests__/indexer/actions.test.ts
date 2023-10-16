import { cliTest, setup, teardown } from '../util'
import path from 'path'
import { Action, ActionType, ActionStatus } from '@graphprotocol/indexer-common'

const baseDir = path.join(__dirname, '..')
describe('Indexer actions tests', () => {
  describe('With indexer management server', () => {
    beforeAll(setup)
    afterAll(teardown)
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
      beforeAll(createTestAction)
      afterAll(truncateActions)
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

async function createTestAction() {
  await Action.create({
    type: ActionType.ALLOCATE,
    status: ActionStatus.SUCCESS,
    deploymentID: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
    source: 'test',
    reason: 'test',
    protocolNetwork: 'eip155:5',
  })
  await Action.create({
    type: ActionType.UNALLOCATE,
    status: ActionStatus.FAILED,
    deploymentID: 'QmfWRZCjT8pri4Amey3e3mb2Bga75Vuh2fPYyNVnmPYL66',
    source: 'test',
    reason: 'test',
    protocolNetwork: 'eip155:5',
  })
}

async function truncateActions() {
  await Action.destroy({
    truncate: true,
  })
}
