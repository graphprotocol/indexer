/* eslint-disable @typescript-eslint/no-explicit-any */

import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadValidatedConfig } from '../../config'
import { createIndexerManagementClient } from '../../client'
import gql from 'graphql-tag'
import { displayRules, indexingRuleFromGraphQL } from '../../rules'
import { printIndexerAllocations, indexerAllocationFromGraphQL } from '../../allocations'
import {
  extractProtocolNetworkOption,
  formatData,
  parseOutputFormat,
  pickFields,
} from '../../command-helpers'

const HELP = `
${chalk.bold('graph indexer status')}

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network                 [Required] the rule's protocol network
`

module.exports = {
  name: 'status',
  alias: [],
  description: 'Check the status of an indexer',
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox

    const { h, help, o, output } = toolbox.parameters.options
    const outputFormat = parseOutputFormat(print, o || output || 'table')

    if (help || h) {
      print.info(HELP)
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    let protocolNetwork: string
    try {
      protocolNetwork = extractProtocolNetworkOption(toolbox.parameters.options)
    } catch (error) {
      print.error(error.message)
      process.exit(1)
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
            query ($protocolNetwork: String!) {
              indexerRegistration(protocolNetwork: $protocolNetwork) {
                url
                address
                protocolNetwork
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

              indexerAllocations(protocolNetwork: $protocolNetwork) {
                id
                protocolNetwork
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                subgraphDeployment
                signalledTokens
                stakedTokens
              }

              indexerEndpoints(protocolNetwork: $protocolNetwork) {
                service {
                  url
                  healthy
                  protocolNetwork
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

              indexingRules(merged: true, protocolNetwork: $protocolNetwork) {
                identifier
                protocolNetwork
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
                safety
              }
            }
          `,
          { protocolNetwork },
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
      print.info(chalk.cyan('Registration'))
      print.info(formatData(data.registration, outputFormat))
      print.info(chalk.cyan('\nEndpoints'))
      if (data.endpoints.error) {
        print.error(formatData([data.endpoints], outputFormat))
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
          data.endpoints.find((endpoint: any) => {
            if (endpoint.tests) {
              return endpoint.tests.find((test: any) => test.error !== null)
            }
          })
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
      print.info(chalk.cyan('\nIndexer Deployments'))
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
                latestBlockNumber: chain.latestBlock?.number,
                chainHeadBlockNumber: chain.chainHeadBlock?.number,
                earliestBlockNumber: chain.earliestBlock?.number,
              })),
            ),
            outputFormat,
          ),
        )
      }
      print.info(chalk.cyan('\nIndexer Allocations'))
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
      print.info(chalk.cyan('\nIndexing Rules'))
      if (data.indexingRules.length === 1 && data.indexingRules[0].error) {
        print.info(formatData(data.indexingRules[0], outputFormat))
      } else {
        print.info(displayRules(outputFormat, 'all', data.indexingRules, []))
      }
    } else {
      print.info(formatData(data, outputFormat))
    }
  },
}
