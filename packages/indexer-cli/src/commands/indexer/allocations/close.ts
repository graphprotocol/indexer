import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { closeAllocation } from '../../../allocations'
import { validatePOI, printObjectOrArray } from '../../../command-helpers'
import { validateNetworkIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer allocations close')} [options] <network> <id> <poi>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POIaccuracy checks and submit transaction with provided data
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Networks:')}
  mainnet, arbitrum-one, sepolia or arbitrum sepolia
`

module.exports = {
  name: 'close',
  alias: [],
  description: 'Close an allocation',
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

    const [network, id, unformattedPoi] = parameters.array || []

    if (id === undefined) {
      spinner.fail(`Missing required argument: 'id'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    let protocolNetwork: string
    if (!network) {
      spinner.fail(`Missing required argument: 'network'`)
      print.info(HELP)
      process.exitCode = 1
      return
    } else {
      try {
        protocolNetwork = validateNetworkIdentifier(network)
      } catch (error) {
        spinner.fail(`Invalid value for argument 'network': '${network}' `)
        process.exitCode = 1
        return
      }
    }

    let poi: string | undefined
    try {
      poi = validatePOI(unformattedPoi)
    } catch (error) {
      spinner.fail(`Invalid POI provided, '${unformattedPoi}'. ` + error.message)
      process.exitCode = 1
      return
    }

    spinner.text = `Closing allocation '${id}`
    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })
      const closeResult = await closeAllocation(client, id, poi, toForce, protocolNetwork)

      spinner.succeed('Allocation closed')
      printObjectOrArray(print, outputFormat, closeResult, [
        'allocation',
        'allocatedTokens',
        'indexingRewards',
      ])
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
