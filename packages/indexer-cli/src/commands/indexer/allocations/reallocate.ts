import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { reallocateAllocation } from '../../../allocations'
import {
  extractProtocolNetworkOption,
  printObjectOrArray,
  validatePOI,
} from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer allocations reallocate',
)} [options] <id> <amount> <poi> <blockNumber> <publicPOI>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <network>       The protocol network for this action (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data

  ${chalk.dim('Arguments:')}
  <id>                            The allocation id to close
  <poi>                           (optional) The POI to close the allocation with
  <blockNumber>                   (optional, horizon only) The block number the POI was computed at. Must be set if POI is provided.
  <publicPOI>                     (optional, horizon only) The public POI to close the allocation with. Must be same block height as POI.
`

module.exports = {
  name: 'reallocate',
  alias: [],
  description: 'Reallocate to subgraph deployment',
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

    // eslint-disable-next-line prefer-const
    let [id, amount, poi, unformattedBlockNumber, publicPOI] = parameters.array || []

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

      validatePOI(poi)
      validatePOI(publicPOI)
      const allocationAmount = BigInt(amount)
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      spinner.text = `Closing '${id}' and reallocating`
      const reallocateResult = await reallocateAllocation(
        client,
        id,
        poi,
        Number(unformattedBlockNumber),
        publicPOI,
        allocationAmount,
        toForce,
        protocolNetwork,
      )

      spinner.succeed('Reallocated')
      printObjectOrArray(
        print,
        outputFormat,
        [reallocateResult],
        [
          'closedAllocation',
          'indexingRewardsCollected',
          'createdAllocation',
          'createdAllocationStake',
        ],
      )
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
