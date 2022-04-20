import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import gql from 'graphql-tag'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { processIdentifier, SubgraphIdentifierType } from '@graphprotocol/indexer-common'
import { IndexerAllocation, printIndexerAllocations } from '../../../allocations'
import { utils } from 'ethers'

const HELP = `
${chalk.bold('graph indexer allocations get')} [options]
${chalk.bold('graph indexer allocations get')} [options] <allocation-id>
${chalk.bold('graph indexer allocations get')} [options] all

${chalk.dim('Options:')}

  -h, --help                                Show usage information
      --status active|closed|claimable      Filter by status 
      --deployment <id>                     Fetch only allocations for a specific subgraph deployment
  -o, --output table|json|yaml              Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'List one or more allocations',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { status, deployment, h, help, o, output } = parameters.options

    const [allocation] = fixParameters(parameters, { h, help }) || []
    const outputFormat = o || output || 'table'

    if (help || h) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    try {
      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}" must be one of 'json', 'yaml' or 'table'`,
        )
      }

      if (status && !['active', 'closed', 'claimable'].includes(status)) {
        throw Error(
          `Invalid '--status' provided, must be one of 'active', 'closed' or 'claimable'`,
        )
      }

      if (allocation) {
        if (allocation !== 'all' && !utils.isHexString(allocation, 20)) {
          throw Error(
            `Invalid 'allocation-id' provided ('${allocation}'), must be a bytes20 string or 'all'`,
          )
        }

        if (allocation == 'all') {
          if (status || deployment) {
            throw Error(
              `Invalid query, cannot specify '--status' or '--deployment' filters in addition to 'allocation = all'`,
            )
          }
        }
      }

      let deploymentString: string | undefined = undefined
      let type: SubgraphIdentifierType

      if (deployment) {
        ;[deploymentString, type] = await processIdentifier(deployment, {
          all: true,
          global: false,
        })
        if (type !== SubgraphIdentifierType.DEPLOYMENT) {
          throw Error(
            `Invalid '--deployment' must be a valid deployment ID (bytes32 or base58 formatted)`,
          )
        }
      }

      spinner.text = 'Querying indexer management server'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .query(
          gql`
            query allocations($filter: AllocationFilter!) {
              allocations(filter: $filter) {
                id
                indexer
                subgraphDeployment
                allocatedTokens
                signalledTokens
                stakedTokens
                createdAtEpoch
                closedAtEpoch
                ageInEpochs
                closeDeadlineEpoch
                closeDeadlineBlocksRemaining
                closeDeadlineTimeRemaining
                indexingRewards
                queryFeesCollected
                status
              }
            }
          `,
          {
            filter: {
              status: status ? status : null,
              allocation: allocation ? allocation : null,
            },
          },
        )
        .toPromise()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (result.error) {
        throw result.error
      }

      const allocations = deploymentString
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.data.allocations.filter((allocation: any) => {
            return (
              new SubgraphDeploymentID(allocation.subgraphDeployment).toString() ===
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              new SubgraphDeploymentID(deploymentString!).toString()
            )
          })
        : result.data.allocations

      let displayProperties: (keyof IndexerAllocation)[] = [
        'id',
        'indexer',
        'subgraphDeployment',
        'allocatedTokens',
        'signalledTokens',
        'stakedTokens',
        'createdAtEpoch',
        'closedAtEpoch',
        'ageInEpochs',
        'indexingRewards',
        'queryFeesCollected',
        'status',
      ]
      if (!allocation || allocation == 'all') {
        displayProperties = displayProperties.filter(property => property !== 'indexer')
      }
      if (status == 'active') {
        displayProperties = displayProperties.filter(
          property => property !== 'closedAtEpoch',
        )
      }
      spinner.succeed('Allocations')
      printIndexerAllocations(print, outputFormat, allocations, displayProperties)
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
