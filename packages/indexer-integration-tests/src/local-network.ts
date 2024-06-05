/** @module local-network
 *
 * @description
 * This module provides functions and interfaces for interacting with 'local-network', a Docker Compose network used for testing.
 */

import * as dockerCompose from 'docker-compose'

// TODO: load this from local-network itself
export const INDEXING_PAYMENTS_ENDPOINT =
  'http://localhost:7601/indexing-payments'

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
export async function restartDockerComposeServices(
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
