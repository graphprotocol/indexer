import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { extractProtocolNetworkOption } from '../../../command-helpers'
import gql from 'graphql-tag'
import { IndexerThawRequest, printIndexerThawRequests } from '../../../thaw-requests'

const HELP = `
${chalk.bold('graph indexer provision list-thaw')} [options]

${chalk.dim('Options:')}

  -h, --help                                Show usage information
  -n, --network                             Filter provisions by their protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml              Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'list-thaw',
  alias: [],
  description: "List thaw requests for the indexer's provision",
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

      spinner.text = 'Getting thaw requests for the provision'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .query(
          gql`
            query thawRequests($protocolNetwork: String!) {
              thawRequests(protocolNetwork: $protocolNetwork) {
                id
                fulfilled
                dataService
                indexer
                shares
                thawingUntil
                protocolNetwork
                currentBlockTimestamp
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

      const displayProperties: (keyof IndexerThawRequest)[] = [
        'id',
        'fulfilled',
        'protocolNetwork',
        'shares',
        'thawingUntil',
      ]

      if (result.data.thawRequests) {
        spinner.succeed('Got thaw requests')
        printIndexerThawRequests(
          print,
          outputFormat,
          result.data.thawRequests,
          displayProperties,
        )

        print.info('')
        print.info(
          `Latest block timestamp: ${new Date(
            Number(result.data.thawRequests[0].currentBlockTimestamp) * 1000,
          ).toLocaleString()}`,
        )
      } else {
        spinner.fail('Failed to get thaw requests')
      }
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
