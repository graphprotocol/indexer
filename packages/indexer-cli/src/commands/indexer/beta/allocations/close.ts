import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../../config'
import { createIndexerManagementClient } from '../../../../client'
import { fixParameters, validateDeploymentID } from '../../../../command-helpers'
import gql from 'graphql-tag'
import { printAllocations } from '../../../../allocations'
import { SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'

const HELP = `
${chalk.bold('graph indexer allocations close')} [options] <id> [<id> ...]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'close',
  alias: [],
  description: 'Close one or more allocations',
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
    const ids = fixParameters(parameters, { h, help, active, claimable }) || []
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
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      const result = await client
        .mutation(
          gql`
            query closeAllocations($requests: [CloseAllocationRequest!]!) {
              closeAllocations(requests: $requests) {
                id
                success
                indexerRewards
              }
            }
          `,
          {
            requests: ids.map(id => ({ id })),
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      console.log(result.data.closeAllocations)

      // printCloseAllocationResults(result.data.closeAllocations)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }
  },
}
