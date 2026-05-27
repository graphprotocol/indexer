import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { resizeAllocation } from '../../../allocations'
import {
  extractProtocolNetworkOption,
  printObjectOrArray,
  getRawPositionalArgs,
} from '../../../command-helpers'

const HELP = `
${chalk.bold('graph indexer allocations resize')} [options] <id> <amount>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <network>       The protocol network for this action (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Arguments:')}

  <id>                          The allocation id to resize
  <amount>                      The new amount of GRT for the allocation

${chalk.dim('Note:')}

  This command is only available for Horizon allocations. It changes the
  allocated stake without closing the allocation.
`

module.exports = {
  name: 'resize',
  alias: [],
  description: 'Resize allocation stake without closing (Horizon)',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, o, output } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined

    if (toHelp) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      spinner.fail(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const [id, amount] = getRawPositionalArgs(parameters.array || [])

    if (id === undefined) {
      spinner.fail(`Missing required argument: 'id'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    if (amount === undefined) {
      spinner.fail(`Missing required argument: 'amount'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    try {
      const protocolNetwork = extractProtocolNetworkOption(parameters.options, true)

      if (!protocolNetwork) {
        throw new Error(
          'Must provide a network identifier' + `(network: '${protocolNetwork}')`,
        )
      }

      const allocationAmount = BigInt(amount)
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      spinner.text = `Resizing allocation '${id}'`
      const result = await resizeAllocation(client, id, allocationAmount, protocolNetwork)

      spinner.succeed('Allocation resized')
      printObjectOrArray(
        print,
        outputFormat,
        [result],
        ['allocation', 'previousAmount', 'newAmount', 'protocolNetwork'],
        0,
      )
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
