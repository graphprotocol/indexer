import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { disputes, printDisputes } from '../../../disputes'

const HELP = `
${chalk.bold(
  'graph indexer disputes get',
)} [options] <status> <minimumAllocationClosedEpoch>

  <status>  potential|pending|valid
  
${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: `Cross-check POIs submitted in the network`,
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [status, minAllocationClosedEpoch] = parameters.array || []
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

    if (!status) {
      print.error(`No dispute status (potential, pending or valid) provided`)
      process.exitCode = 1
      return
    }

    if (minAllocationClosedEpoch === null || minAllocationClosedEpoch === undefined) {
      print.error(`No minimum epoch for closed allocations provided`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    // Create indexer API client
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      const storedDisputes = await disputes(client, status, +minAllocationClosedEpoch)

      printDisputes(print, outputFormat, storedDisputes)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
