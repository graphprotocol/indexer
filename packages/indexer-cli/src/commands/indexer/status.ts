/* eslint-disable @typescript-eslint/no-explicit-any */

import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadValidatedConfig } from '../../config'
import { createIndexerManagementClient } from '../../client'
import gql from 'graphql-tag'
import { printIndexingRules, indexingRuleFromGraphQL } from '../../rules'
import { printIndexerAllocations, indexerAllocationFromGraphQL } from '../../allocations'
import { formatData, pickFields } from '../../command-helpers'

const HELP = `
${chalk.bold('graph indexer status')}

${chalk.dim('Options:')}

  -h, --help                    Show usage information
`

module.exports = {
  name: 'status',
  alias: [],
  description: 'Check the status of an indexer',
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox

    const { h, help, o, output } = toolbox.parameters.options
    const outputFormat = o || output || 'table'

    if (help || h) {
      print.info(HELP)
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      print.error(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    // Create indexer API client
    const client = await createIndexerManagementClient({ url: config.api })

    // Query status information
    let result: any | undefined
    try {
      result = await client
        .query(
          gql`
            query {
              indexerRegistration {
                url
                address
                registered
                location {
                  latitude
                  longitude
                }
              }

              indexerDeployments {
                subgraphDeployment
                synced
                health
                fatalError {
                  handler
                  message
                }
                node
                chains {
                  network
                  latestBlock {
                    number
                  }
                  chainHeadBlock {
                    number
                  }
                  earliestBlock {
                    number
                  }
                }
              }

              indexerAllocations {
                id
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                subgraphDeployment
                signalledTokens
                stakedTokens
              }

              indexerEndpoints {
                service {
                  url
                  healthy
                  tests {
                    test
                    error
                    possibleActions
                  }
                }
                status {
                  url
                  healthy
                  tests {
                    test
                    error
                    possibleActions
                  }
                }
              }

              indexingRules(merged: true) {
                identifier
                identifierType
                allocationAmount
                allocationLifetime
                autoRenewal
                parallelAllocations
                maxAllocationPercentage
                minSignal
                maxSignal
                minStake
                minAverageQueryFees
                custom
                decisionBasis
                requireSupported
              }
            }
          `,
          {},
        )
        .toPromise()
    } catch (error) {
      print.error(`Failed to fetch status information: ${error}`)
      process.exit(1)
    }

    if (result.error) {
      print.error(`Error fetching status information: ${result.error}`)
      process.exit(1)
    }

    const data: any = {
      registration: null,
      endpoints: null,
      indexerDeployments: null,
      indexerAllocations: null,
      indexingRules: null,
    }

    if (result.data.indexerRegistration) {
      data.registration = pickFields(result.data.indexerRegistration, [])
      if (data.registration.location) {
        data.registration.location = `${data.registration.location.latitude},${data.registration.location.longitude}`
      } else {
        data.registration.location = 'No location specified'
      }
    } else {
      data.registration = {
        error:
          'Not registered yet. Make sure to run `indexer-agent` and register on chain',
      }
    }

    if (result.data.indexerEndpoints) {
      const keys = Object.keys(pickFields(result.data.indexerEndpoints, []))
      keys.sort()

      const statusUp = outputFormat == 'table' ? chalk.green('up') : 'up'
      const statusDown = outputFormat == 'table' ? chalk.red('down') : 'down'

      data.endpoints = keys.reduce(
        (out, key) => [
          ...out,
          {
            name: key,
            url: result.data.indexerEndpoints[key].url,
            status: result.data.indexerEndpoints[key].healthy ? statusUp : statusDown,
            tests: result.data.indexerEndpoints[key].tests,
          },
        ],
        [] as any,
      )
    } else {
      data.endpoints = {
        error:
          'Indexer endpoints unknown. Make sure to run `indexer-agent` and register on chain',
      }
    }

    if (result.data.indexerDeployments) {
      data.indexerDeployments = result.data.indexerDeployments
    }

    if (result.data.indexerAllocations) {
      data.indexerAllocations = result.data.indexerAllocations.map(
        indexerAllocationFromGraphQL,
      )
    }

    if (result.data.indexingRules) {
      if (result.data.indexingRules.length === 0) {
        data.indexingRules = [
          {
            error:
              'No indexing rules defined, make sure `indexer-agent` is starting without issues',
          },
        ]
      } else {
        result.data.indexingRules.sort((a: any, b: any) =>
          a.identifier.localeCompare(b.deployment),
        )
        data.indexingRules = result.data.indexingRules.map(indexingRuleFromGraphQL)
      }
    }

    if (outputFormat === 'table') {
      print.info('Registration')
      print.info(formatData(data.registration, outputFormat))
      print.info('')
      print.info('Endpoints')
      if (data.endpoints.error) {
        print.info(formatData([data.endpoints], outputFormat))
      } else {
        print.info(
          formatData(
            data.endpoints.map((endpoint: any) =>
              pickFields(endpoint, ['name', 'url', 'status']),
            ),
            outputFormat,
          ),
        )
        if (
          data.endpoints.find((endpoint: any) =>
            endpoint.tests.find((test: any) => test.error !== null),
          )
        ) {
          print.error('The following endpoint tests failed:\n')
          for (const endpoint of data.endpoints) {
            const failingTests = endpoint.tests.filter((test: any) => test.error !== null)
            if (failingTests.length > 0) {
              print.error(endpoint.url)
              for (const test of failingTests) {
                print.error(`  Test: ${test.test}`)
                print.error(`  Error: ${test.error}`)
                print.error(`  Possible actions:`)
                for (const action of test.possibleActions) {
                  print.error(`    - ${action}`)
                }
              }
            }
          }
        }
      }
      print.info('')
      print.info('Indexer Deployments')
      if (data.indexerDeployments) {
        print.info(
          formatData(
            data.indexerDeployments.flatMap((deployment: any) =>
              deployment.chains.map((chain: any) => ({
                deployment: deployment.subgraphDeployment,
                synced: deployment.synced,
                health: deployment.health,
                fatalError: deployment.fatalError
                  ? JSON.stringify(deployment.fatalError.message)
                  : '-',
                node: deployment.node,
                network: chain.network,
                latestBlockNumber: chain.latestBlock.number,
                chainHeadBlockNumber: chain.chainHeadBlock.number,
                earliestBlockNumber: chain.earliestBlock?.number,
              })),
            ),
            outputFormat,
          ),
        )
      }
      print.info('')
      print.info('Indexer Allocations')
      if (data.indexerAllocations) {
        printIndexerAllocations(print, outputFormat, data.indexerAllocations, [
          'id',
          'subgraphDeployment',
          'allocatedTokens',
          'createdAtEpoch',
          'signalledTokens',
          'stakedTokens',
        ])
      }
      print.info('')
      print.info('Indexing Rules')
      if (data.indexingRules.length === 1 && data.indexingRules[0].error) {
        print.info(formatData(data.indexingRules[0], outputFormat))
      } else {
        printIndexingRules(print, outputFormat, 'all', data.indexingRules, [])
      }
    } else {
      print.info(formatData(data, outputFormat))
    }
  },
}
