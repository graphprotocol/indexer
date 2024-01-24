import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { BigNumber } from 'ethers'
import { createAllocation } from '../../../allocations'
import {
  processIdentifier,
  SubgraphIdentifierType,
  validateNetworkIdentifier,
} from '@graphprotocol/indexer-common'
import { printObjectOrArray } from '../../../command-helpers'

const HELP = `
${chalk.bold(
  'graph indexer allocations create',
)} [options] <deployment-id> <network> <amount> <index-node>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Networks:')}
  mainnet, arbitrum-one, sepolia or arbitrum sepolia
`

module.exports = {
  name: 'create',
  alias: [],
  description: 'Create an allocation',
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

    const [deploymentID, protocolNetwork, amount, indexNode] = parameters.array || []

    try {
      if (!deploymentID || !amount || !protocolNetwork) {
        throw new Error(
          'Must provide a deployment ID, a network identifier and allocation amount' +
            `(deploymentID: '${deploymentID}', network: '${protocolNetwork}' allocationAmount: '${amount}')`,
        )
      }

      // This nested try block is necessary to complement the parsing error with the 'network' field.
      try {
        validateNetworkIdentifier(protocolNetwork)
      } catch (parsingError) {
        throw new Error(`Invalid 'network' provided. ${parsingError}`)
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
      const allocationAmount = BigNumber.from(amount)

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
      ])
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
