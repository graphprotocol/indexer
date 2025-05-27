import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { extractProtocolNetworkOption } from '../../../command-helpers'
import gql from 'graphql-tag'
import { IndexerProvision, printIndexerProvisions } from '../../../provisions'
import { commify } from '@graphprotocol/common-ts'
import { formatGRT } from '@graphprotocol/common-ts'

const HELP = `
${chalk.bold('graph indexer provision remove')} [options]

${chalk.dim('Options:')}

  -h, --help                                Show usage information
  -n, --network                             Filter provisions by their protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml              Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'remove',
  alias: [],
  description: "Remove thawed stake from the indexer's provision",
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, o, output } = parameters.options

    const outputFormat = o || output || 'table'

    if (help || h) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    try {
      const protocolNetwork = extractProtocolNetworkOption(parameters.options)

      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}" must be one of 'json', 'yaml' or 'table'`,
        )
      }

      spinner.text = 'Removing thawed stake from the provision'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .mutation(
          gql`
            mutation removeFromProvision($protocolNetwork: String!) {
              removeFromProvision(protocolNetwork: $protocolNetwork) {
                id
                dataService
                indexer
                tokensProvisioned
                tokensThawing
                tokensRemoved
                protocolNetwork
              }
            }
          `,
          {
            protocolNetwork,
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
        'tokensProvisioned',
        'tokensThawing',
      ]

      if (result.data.removeFromProvision) {
        spinner.succeed('Thawed stake removed from the provision')
        printIndexerProvisions(
          print,
          outputFormat,
          result.data.removeFromProvision,
          displayProperties,
        )

        print.info('')
        print.info(
          `Removed ${commify(
            formatGRT(result.data.removeFromProvision.tokensRemoved),
          )} GRT from the provision`,
        )
      } else {
        spinner.fail('Failed to remove thawed stake from the provision')
      }
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
