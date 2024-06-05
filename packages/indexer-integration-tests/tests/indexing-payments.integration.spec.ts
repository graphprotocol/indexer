import {
  AGREEMENT_QUERY,
  CREATE_AGREEMENT_MUTATION,
  PRICE_QUERY,
} from '@graphprotocol/indexer-common' // Update with actual path
import axios from 'axios'
import * as dockerCompose from 'docker-compose'
import path from 'path'

const GRAPHQL_ENDPOINT = 'http://localhost:7601/indexing-payments'
const HEADERS = { 'Content-Type': 'application/json' }

/** assumed to be the active db used by the indexer-service (ts) and the indexer-agent */
// const INDEXER_COMPONENTS_DB = 'indexer_components_1'

/** Reset the database being used*/
// async function resetDatabase(db: string): Promise<void> {
//   console.log('resetting database')
//   const client = new Client()
//   client.connect()
//   await client.query(`DROP DATABASE IF EXISTS ${db}`)
//   await client.query(`CREATE DATABASE  ${db}`)
//   await client.end()
// }

interface Service {
  name: string
  options?: dockerCompose.IDockerComposeOptions
}

/** Restart a list of docker-compose services
 *
 * @param serviceNames - list of services to restart
 * @param dockerComposeYamlDir - the *directory containing* the docker-compose.yaml file
 *
 * Given a list of services, they will be stopped in order
 * `[a, b, c]`
 * and started in reverse order
 * `[c, b, a]`
 */
async function restartDockerComposeServices(
  services: Service[],
  defaultOptions: dockerCompose.IDockerComposeOptions,
): Promise<void> {
  const serviceNames = services.map(service => service.name)
  console.log(`Restarting services ${serviceNames}`)

  for (const service of services) {
    console.log(`Restart(${service.name}) - stopOne`)
    await dockerCompose.stopOne(service.name, service.options || defaultOptions)
  }

  for (const service of services.slice().reverse()) {
    console.log(`Restart(${service.name}) - upOne`)
    const upResult = await dockerCompose.upOne(
      service.name,
      service.options || defaultOptions,
    )
    console.log(`Restarted(${service.name}) - upOne result`, upResult)
  }

  const ps = await dockerCompose.ps(defaultOptions)
  for (const service of services) {
    if (!ps.data.services.some(s => s.name === service.name)) {
      console.log(`Restart(${service.name}) - not running`)
      console.error('Service logs:')
      const logs = await dockerCompose.logs(
        service.name,
        service.options || defaultOptions,
      )
      const data = logs.out.split('\n')
      console.error(data)
      throw new Error(`Service ${service.name} not running after restart`)
    } else {
      console.log(`Restart(${service.name}) - running`)
    }
  }
}

async function waitForSeconds(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

const TIMEOUT = 30000
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
      GRAPHQL_ENDPOINT,
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
      GRAPHQL_ENDPOINT,
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
      GRAPHQL_ENDPOINT,
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
