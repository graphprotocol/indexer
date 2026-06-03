import { cliTest, connect } from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')
describe('Indexer dips tests', () => {
  describe('Dips help', () => {
    beforeAll(connect)
    cliTest('Indexer dips', ['indexer', 'dips'], 'references/indexer-dips', {
      expectedExitCode: 1,
      cwd: baseDir,
      timeout: 10000,
    })
    cliTest(
      'Indexer dips agreements',
      ['indexer', 'dips', 'agreements'],
      'references/indexer-dips-agreements',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer dips agreements get help',
      ['indexer', 'dips', 'agreements', 'get', '--help'],
      'references/indexer-dips-agreements-get',
      {
        expectedExitCode: 0,
        cwd: baseDir,
        timeout: 10000,
      },
    )
  })
})
