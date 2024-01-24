import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { disputes, printDisputes } from '../../../disputes'
import { parseOutputFormat, extractProtocolNetworkOption } from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer disputes get',
)} [options] potential <minimumAllocationClosedEpoch>

${chalk.dim('Options:')}

  -n, --network                 Filter by protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia) 
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
    const outputFormat = parseOutputFormat(print, o || output || 'table')

    if (help || h) {
      print.info(HELP)
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    if (!status || status !== 'potential') {
      print.error(`Must provide a dispute status filter, options: 'potential'`)
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
      const protocolNetwork = extractProtocolNetworkOption(parameters.options)
      const storedDisputes = await disputes(
        client,
        status,
        +minAllocationClosedEpoch,
        protocolNetwork,
      )
      printDisputes(print, outputFormat, storedDisputes)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
