import { restartDockerComposeServices } from '..'

// import axios from 'axios'
import path from 'path'

const TIMEOUT = 30000

// TODO deprecate this entirely in favor of a health check
async function waitForSeconds(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

beforeEach(async () => {
  const sourceRoot = path.resolve(__dirname, '../../../')
  console.log('sourceRoot', sourceRoot)

  const defaultOptions = {
    cwd: path.resolve(sourceRoot, '../local-network'),
    config: 'docker-compose.yaml',
    env: {
      ...process.env,
      INDEXER_SERVICE_SOURCE_ROOT: sourceRoot,
      INDEXER_AGENT_SOURCE_ROOT: sourceRoot,
    },
  }
  await restartDockerComposeServices(
    [
      {
        name: 'indexer-service-ts',
        options: {
          ...defaultOptions,
          commandOptions: ['--no-deps'],
          config: [
            'docker-compose.yaml',
            // use the dev env overrides to test against the local checkout
            'overrides/indexer-service-ts-dev/indexer-service-ts-dev.yaml',
          ],
        },
      },
      {
        name: 'indexer-agent',
        options: {
          ...defaultOptions,
          commandOptions: ['--no-deps'],
          config: [
            'docker-compose.yaml',
            // use the dev env overrides to test against the local checkout
            'overrides/indexer-agent-dev/indexer-agent-dev.yaml',
          ],
        },
      },
      { name: 'postgres' },
    ],
    defaultOptions,
  )

  // wait for the service to start. TODO use a docker-compose health check instead
  await waitForSeconds(5)
}, TIMEOUT)

describe('indexer-agent', () => {
  it('should wait for block number in confirmation', async () => {
    // TODO
    expect(true).toBe(true)
  })
})
