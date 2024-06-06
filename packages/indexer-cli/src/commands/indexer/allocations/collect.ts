import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { submitCollectReceiptsJob } from '../../../allocations'
import { validateNetworkIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer allocations collect')} [options] <network> <id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Networks:')}
  mainnet, arbitrum-one, sepolia or arbitrum sepolia
`

module.exports = {
  name: 'collect',
  alias: [],
  description: 'Collect receipts for an allocation',
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

    const [network, id] = parameters.array || []

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

    spinner.text = `Collecting receipts for allocation '${id}`
    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })
      await submitCollectReceiptsJob(client, id, protocolNetwork)

      spinner.succeed('Submitted collect receipts job')
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
