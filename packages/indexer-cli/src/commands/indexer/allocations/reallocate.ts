import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { utils } from "ethers";
import { refreshAllocation } from "../../../allocations";

const HELP = `
${chalk.bold('graph indexer allocations refresh')} [options] <id> <poi> <amount>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data 
`

module.exports = {
  name: 'refresh',
  alias: [],
  description: 'Refresh an allocation',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const {
      h,
      help,
      f,
      force,
    } = parameters.options

    const toHelp = help || h || undefined
    const toForce = force || f || false

    if (toHelp) {
      print.info(HELP)
      return
    }

    // eslint-disable-next-line prefer-const
    let [id, poi, amount] = parameters.array || []

    if(poi !== undefined) {
      if(typeof poi == 'number' && poi == 0) {
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
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })
      const result = await refreshAllocation(client, id, poi, amount, toForce)
      print.info(result)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }
  },
}
