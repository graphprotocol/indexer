import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { utils } from 'ethers'
import { closeAllocation } from '../../../allocations'
import { printObjectOrArray } from '../../../command-helpers'

const HELP = `
${chalk.bold('graph indexer allocations close')} [options] <id> <poi>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POIaccuracy checks and submit transaction with provided data
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML 
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

    const [id] = parameters.array || []
    let [, poi] = parameters.array || []

    if (id === undefined) {
      spinner.fail(`Missing required argument: 'id'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    if (poi !== undefined) {
      if (typeof poi == 'number' && poi == 0) {
        poi = utils.hexlify(Array(32).fill(0))
      }
      try {
        // Ensure user provided POI is formatted properly - '0x...' (32 bytes)
        const isHex = utils.isHexString(poi, 32)
        if (!isHex) {
          throw new Error('Must be a 32 byte length hex string')
        }
      } catch (error) {
        spinner.fail(`Invalid POI provided, '${poi}'. ` + error.toString())
        process.exitCode = 1
        return
      }
    }

    spinner.text = `Closing allocation '${id}`
    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })
      const closeResult = await closeAllocation(client, id, poi, toForce)

      spinner.succeed('Allocation closed')
      printObjectOrArray(print, outputFormat, closeResult, [
        'allocation',
        'allocatedTokens',
        'indexingRewards',
        'receiptsWorthCollecting',
      ])
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
