import { cliTest, setupMultiNetworks, teardown } from './util'
import path from 'path'

const baseDir = path.join(__dirname)

describe('Indexer cli tests', () => {
  beforeEach(setupMultiNetworks)
  afterEach(teardown)

  describe('General', () => {
    cliTest('Indexer help', ['indexer', '--help'], 'references/indexer-help', {
      expectedExitCode: 255,
      cwd: baseDir,
      timeout: 10000,
    })

    cliTest('Indexer (no args)', ['indexer'], 'references/indexer-help', {
      expectedExitCode: 255,
      cwd: baseDir,
      timeout: 10000,
    })
    cliTest(
      'Indexer connect - success',
      ['indexer', 'connect', 'http://127.0.0.1:18000'],
      'references/indexer-connect',
      {
        expectedExitCode: 0,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    // TODO: Test that connect should fail with helpful error message if incorrect port is provided or server isn't live
  })
})
