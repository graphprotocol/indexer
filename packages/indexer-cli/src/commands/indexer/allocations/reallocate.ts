import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { BigNumber, utils } from 'ethers'
import { reallocateAllocation } from '../../../allocations'
import { printObjectData } from '../../../command-helpers'

const HELP = `
${chalk.bold('graph indexer allocations reallocate')} [options] <id> <amount> <poi>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data 
`

module.exports = {
  name: 'reallocate',
  alias: [],
  description: 'Reallocate to subgraph deployment',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, f, force, o, output } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined
    const toForce = force || f || false

    if (toHelp) {
      print.info(HELP)
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      print.error(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    // eslint-disable-next-line prefer-const
    let [id, amount, poi] = parameters.array || []

    if (id === undefined) {
      print.error(`Missing required argument: 'id'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    if (amount === undefined) {
      print.error(`Missing required argument: 'amount'`)
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
        print.error(`Invalid POI provided, '${poi}'. ` + error.toString())
        process.exitCode = 1
        return
      }
    }

    try {
      const allocationAmount = BigNumber.from(amount)
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })
      const reallocateResult = await reallocateAllocation(
        client,
        id,
        poi,
        allocationAmount,
        toForce,
      )

      print.success('Allocation reallocated')
      printObjectData(print, outputFormat, reallocateResult, [
        'closedAllocation',
        'indexingRewardsCollected',
        'createdAllocation',
        'createdAllocationStake',
      ])
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }
  },
}
