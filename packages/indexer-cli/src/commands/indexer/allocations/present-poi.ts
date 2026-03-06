import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { presentPOI } from '../../../allocations'
import {
  extractProtocolNetworkOption,
  printObjectOrArray,
  validatePOI,
} from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer allocations present-poi',
)} [options] <id> [poi] [blockNumber] [publicPOI]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <network>       The protocol network for this action (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Arguments:')}

  <id>                          The allocation id to present POI for
  [poi]                         (optional) The POI to submit
  [blockNumber]                 (optional) The block number the POI was computed at
  [publicPOI]                   (optional) The public POI to submit

${chalk.dim('Note:')}

  This command is only available for Horizon allocations. It collects indexing
  rewards without closing the allocation.
`

module.exports = {
  name: 'present-poi',
  alias: [],
  description: 'Present POI and collect rewards without closing (Horizon)',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, f, force, o, output } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined
    const toForce = force || f || false

    if (toHelp) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      spinner.fail(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const [id, poi, unformattedBlockNumber, publicPOI] = parameters.array || []

    if (id === undefined) {
      spinner.fail(`Missing required argument: 'id'`)
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

      validatePOI(poi)
      validatePOI(publicPOI)
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      spinner.text = `Presenting POI for allocation '${id}'`
      const result = await presentPOI(
        client,
        id,
        poi,
        unformattedBlockNumber ? Number(unformattedBlockNumber) : undefined,
        publicPOI,
        toForce,
        protocolNetwork,
      )

      spinner.succeed('POI presented and rewards collected')
      printObjectOrArray(
        print,
        outputFormat,
        [result],
        ['allocation', 'indexingRewardsCollected', 'protocolNetwork'],
        0,
      )
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
