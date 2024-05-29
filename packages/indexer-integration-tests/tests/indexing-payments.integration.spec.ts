import {
  AGREEMENT_QUERY,
  CREATE_AGREEMENT_MUTATION,
  PRICE_QUERY,
} from '@graphprotocol/indexer-common' // Update with actual path
import axios from 'axios'
import * as dockerCompose from 'docker-compose'

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
  serviceNames: string[],
  dockerComposeYamlDir: string,
): Promise<void> {
  const options = {
    cwd: dockerComposeYamlDir,
    config: 'docker-compose.yaml',
    env: {
      ...process.env,
      INDEXER_SERVICE_SOURCE_ROOT: '../../',
    },
  }

  const initialPs = await dockerCompose.ps(options)
  const initialRunningServices = initialPs.data.services.filter(
    service => service.state === 'running' && service.name in serviceNames,
  )

  const serviceEnvs: ServiceEnv[] = []

  interface ServiceEnv {
    name: string
    command: string
    env: string | Record<string, string>
  }

  for (const service of initialRunningServices) {
    console.log(`Initial(${service.name})`)
    const env = await dockerCompose.config(options)
    if (!env.data.config) {
      throw new Error(
        `No config found found for discovered service ${service.name} in ${dockerComposeYamlDir}/docker-compose.yaml`,
      )
    }
    serviceEnvs.push({
      name: service.name,
      command: service.command,
      env: env.data.config.services[service.name],
    })
  }

  console.log(`Restarting services ${serviceNames}`)

  for (const serviceName of serviceNames) {
    console.log(`Restart(${serviceName}) - stopOne`)
    await dockerCompose.stopOne(serviceName, options)
  }

  for (const serviceName of serviceNames.slice().reverse()) {
    console.log(`Restart(${serviceName}) - upOne`)
    const upResult = await dockerCompose.upOne(serviceName, options)
    console.log(`Restarted(${serviceName}) - upOne result`, upResult)
  }

  const ps = await dockerCompose.ps(options)
  console.log('serviceNames', serviceNames)
  console.log('ps.data.services', ps.data.services)

  for (const serviceName of serviceNames) {
    if (!ps.data.services.some(service => service.name === serviceName)) {
      console.log(`Restart(${serviceName}) - not running`)
      console.error('Service logs:')
      const logs = await dockerCompose.logs(serviceName, options)
      const data = logs.out.split('\n')
      console.error('docker-compose logs for service', data)
      throw new Error(`Service ${serviceName} not running after restart`)
    } else {
      console.log(`Restart(${serviceName}) - running`)
    }
  }
}

async function waitForSeconds(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

const TIMEOUT = 30000
beforeEach(async () => {
  await restartDockerComposeServices(
    ['indexer-service-ts', 'postgres'],
    '../../../local-network',
  )

  // wait for the service to start. TODO use a docker-compose health check instead
  await waitForSeconds(5)
}, TIMEOUT)

beforeEach(async () => {
  // await resetDatabase(INDEXER_COMPONENTS_DB)
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
