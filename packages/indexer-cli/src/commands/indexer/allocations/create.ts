import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { createAllocation } from '../../../allocations'
import { processIdentifier, SubgraphIdentifierType } from '@graphprotocol/indexer-common'
import {
  extractProtocolNetworkOption,
  printObjectOrArray,
} from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer allocations create',
)} [options] <deployment-id> <amount> <index-node>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <network>       The protocol network for this action (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
  -w, --wrap [N]                Wrap the output to a specific width (default: 0, no wrapping)
`

module.exports = {
  name: 'create',
  alias: [],
  description: 'Create an allocation',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, o, output, w, wrap } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined
    const wrapWidth = w || wrap || 0

    if (toHelp) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      spinner.fail(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const [deploymentID, amount, indexNode] = parameters.array || []

    try {
      const protocolNetwork = extractProtocolNetworkOption(parameters.options, true)

      if (!deploymentID || !amount || !protocolNetwork) {
        throw new Error(
          'Must provide a deployment ID, a network identifier and allocation amount' +
            `(deploymentID: '${deploymentID}', network: '${protocolNetwork}' allocationAmount: '${amount}')`,
        )
      }

      const [deploymentString, type] = await processIdentifier(deploymentID, {
        all: false,
        global: false,
      })
      if (type !== SubgraphIdentifierType.DEPLOYMENT) {
        throw Error(
          `Invalid 'deploymentID' provided (${deploymentID}), must be bytes32 or base58 formatted)`,
        )
      }
      const allocationAmount = BigInt(amount)

      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      spinner.text = `Creating allocation for deployment '${deploymentString}'`
      const allocateResult = await createAllocation(
        client,
        deploymentString,
        allocationAmount,
        indexNode,
        protocolNetwork,
      )

      spinner.succeed('Allocation created')
      printObjectOrArray(print, outputFormat, allocateResult, [
        'allocation',
        'deployment',
        'allocatedTokens',
        'protocolNetwork',
      ], wrapWidth)
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
