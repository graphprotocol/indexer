import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { extractProtocolNetworkOption } from '../../../command-helpers'
import gql from 'graphql-tag'
import { IndexerProvision, printIndexerProvisions } from '../../../provisions'

const HELP = `
${chalk.bold('graph indexer provision thaw')} [options] <amount>

${chalk.dim('Options:')}

  -h, --help                                Show usage information
  -n, --network                             Filter provisions by their protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml              Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'thaw',
  alias: [],
  description: "Thaw stake from the indexer's provision",
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, o, output } = parameters.options

    const outputFormat = o || output || 'table'

    if (help || h) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    const [amount] = parameters.array || []

    try {
      if (!amount) {
        throw new Error('Must provide an amount to thaw from the provision')
      }

      const protocolNetwork = extractProtocolNetworkOption(parameters.options)

      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}" must be one of 'json', 'yaml' or 'table'`,
        )
      }

      spinner.text = 'Thawing stake from the provision'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .mutation(
          gql`
            mutation thawFromProvision($protocolNetwork: String!, $amount: String!) {
              thawFromProvision(protocolNetwork: $protocolNetwork, amount: $amount) {
                id
                dataService
                indexer
                tokensThawing
                thawingPeriod
                thawingUntil
                protocolNetwork
              }
            }
          `,
          {
            protocolNetwork,
            amount: amount.toString(),
          },
        )
        .toPromise()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (result.error) {
        throw result.error
      }

      const displayProperties: (keyof IndexerProvision)[] = [
        'dataService',
        'protocolNetwork',
        'tokensThawing',
        'thawingPeriod',
        'thawingUntil',
      ]

      if (result.data.thawFromProvision) {
        spinner.succeed('Stake thawed from the provision')
        printIndexerProvisions(
          print,
          outputFormat,
          result.data.thawFromProvision,
          displayProperties,
        )
      } else {
        spinner.fail('Failed to thaw stake from the provision')
      }
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
