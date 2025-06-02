import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { reallocateAllocation } from '../../../allocations'
import { printObjectOrArray, validatePOI } from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer allocations reallocate',
)} [options] <network> <id> <amount> <poi>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data

  ${chalk.dim('Arguments:')}
    <network>                       The network to close the allocation on: mainnet, arbitrum-one, sepolia or arbitrum sepolia
    <id>                            The allocation id to close
    <poi>                           The POI to close the allocation with
    <blockNumber>                   The block number the POI was computed at
    <publicPOI>                     [Horizon] The public POI to close the allocation with. Must be same block height as POI.
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
    let [network, id, amount, poi, unformattedBlockNumber, publicPOI] =
      parameters.array || []

    if (network === undefined) {
      spinner.fail(`Missing required argument: 'network'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

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
        network,
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
