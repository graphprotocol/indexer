import { cliTest, setup, teardown } from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')

describe('Indexer action tests', () => {
  describe('With indexer management server', () => {
    beforeEach(setup)
    afterEach(teardown)
    describe('Action help', () => {
      cliTest('Indexer Actions', ['indexer', 'actions'], 'references/indexer-actions', {
        expectedExitCode: 255,
        cwd: baseDir,
        timeout: 10000,
      })
      cliTest(
        'Indexer Actions help',
        ['indexer', 'actions', '--help'],
        'references/indexer-actions',
        {
          expectedExitCode: 255,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    // describe('Action queue...', () => {
    //   cliTest(
    //     'Indexer actions queue allocate - success',
    //     [
    //       'indexer',
    //       'actions',
    //       'queue',
    //       'allocate',
    //       'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
    //       '100',
    //     ],
    //     'references/indexer-action-queue-allocate',
    //     {
    //       expectedExitCode: 0,
    //       cwd: baseDir,
    //       timeout: 10000,
    //     },
    //   )
    //   cliTest(
    //     'Indexer actions queue - no args',
    //     ['indexer', 'actions', 'queue'],
    //     'references/indexer-actions-queue-no-args',
    //     {
    //       expectedExitCode: 1,
    //       cwd: baseDir,
    //       timeout: 10000,
    //     },
    //   )
    //   cliTest(
    //     'Indexer action queue - invalid deployment ID ',
    //     ['indexer', 'actions', 'queue', 'allocate', 'Qmemememememe', '100'],
    //     'references/indexer-actions-invalid-id',
    //     {
    //       expectedExitCode: 1,
    //       cwd: baseDir,
    //       timeout: 10000,
    //     },
    //   )
    // })
  })
})
