import {
  AGREEMENT_QUERY,
  CREATE_AGREEMENT_MUTATION,
  PRICE_QUERY,
} from '@graphprotocol/indexer-common' // Update with actual path
import { restartDockerComposeServices } from '..'

import axios from 'axios'
import path from 'path'
import { INDEXING_PAYMENTS_ENDPOINT } from '..'

const HEADERS = { 'Content-Type': 'application/json' }
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
    },
  }
  await restartDockerComposeServices(
    [
      {
        name: 'indexer-service-ts',
        options: {
          ...defaultOptions,
          config: [
            'docker-compose.yaml',
            // use the dev env overrides to test against the local checkout
            'overrides/indexer-service-ts-dev/indexer-service-ts-dev.yaml',
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

describe('indexer-payments', () => {
  it('should return an IndexingAgreement for a given signature', async () => {
    const variables = { signature: 'example-signature' }
    const response = await axios.post(
      INDEXING_PAYMENTS_ENDPOINT,
      {
        query: AGREEMENT_QUERY,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    console.log('response.data', response.data)

    expect(response.data.agreement).toMatchObject({
      signature: 'example-signature',
      data: 'example-data',
      protocolNetwork: 'example-network',
    })
  })

  it('should return an IndexingPrice for a given subgraphDeploymentID and protocolNetwork', async () => {
    const variables = {
      subgraphDeploymentID: 'example-id',
      protocolNetwork: 'example-network',
    }

    const response = await axios.post(
      INDEXING_PAYMENTS_ENDPOINT,
      {
        query: PRICE_QUERY,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    expect(response.data.price).toMatchObject({
      subgraphDeploymentID: 'example-id',
      price: 123.45,
      protocolNetwork: 'example-network',
    })
  })

  it('should create an IndexingAgreement', async () => {
    const variables = { signature: 'new-signature', data: 'new-data' }

    const response = await axios.post(
      INDEXING_PAYMENTS_ENDPOINT,
      {
        query: CREATE_AGREEMENT_MUTATION,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    expect(response.data.createIndexingAgreement).toMatchObject({
      signature: 'new-signature',
      data: 'new-data',
      protocolNetwork: 'example-network',
    })
  })
})
