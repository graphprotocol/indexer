import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../../config'
import { createIndexerManagementClient } from '../../../../client'
import { fixParameters, validateDeploymentID } from '../../../../command-helpers'
import gql from 'graphql-tag'
import { printAllocations } from '../../../../allocations'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

const HELP = `
${chalk.bold('graph indexer allocations get')} [options] all
${chalk.bold('graph indexer allocations get')} [options] <allocation-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
      --active                  Shows only allocations that are active
      --claimable               Shows only allocations that can be claimed
      --deployment <id>         Shows only allocations for a specific subgraph deployment
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get one or more indexing allocations',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const {
      active,
      claimable,
      deployment: rawDeployment,
      h,
      help,
      o,
      output,
    } = parameters.options
    const [id, ...keys] = fixParameters(parameters, { h, help, active, claimable }) || []
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

    if (rawDeployment) {
      try {
        validateDeploymentID(rawDeployment, { all: true, global: false })
      } catch (error) {
        print.error(error.toString())
        process.exitCode = 1
        return
      }
    }

    const deployment = rawDeployment
      ? rawDeployment === 'all'
        ? 'all'
        : new SubgraphDeploymentID(rawDeployment)
      : 'all'

    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      const result = await client
        .query(
          gql`
            query allocations($filter: AllocationFilter!) {
              allocations(filter: $filter) {
                id
                deployment
                allocatedTokens
                createdAtEpoch
                closedAtEpoch
                closeDeadlineEpoch
                closeDeadlineBlocksRemaining
                closeDeadlineTimeRemaining
                indexingRewards
                queryFees
                status
              }
            }
          `,
          {
            filter: {
              active: !claimable,
              claimable: !active,
            },
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allocations = result.data.allocations.filter((allocation: any) => {
        const allocationDeployment = new SubgraphDeploymentID(allocation.deployment)
        return (
          deployment === 'all' || allocationDeployment.ipfsHash === deployment.ipfsHash
        )
      })
      printAllocations(print, outputFormat, deployment, allocations)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }
  },
}
