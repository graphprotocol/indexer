import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { extractProtocolNetworkOption } from '../../../command-helpers'
import gql from 'graphql-tag'
import { IndexerProvision, printIndexerProvisions } from '../../../provisions'
import { commify, formatGRT } from '@graphprotocol/common-ts'

const HELP = `
${chalk.bold('graph indexer provision get')} [options]

${chalk.dim('Options:')}

  -h, --help                                Show usage information
  -n, --network                             Filter provisions by their protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml              Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'List indexer provision details',
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

      spinner.text = 'Querying indexer management server'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .query(
          gql`
            query provisions($protocolNetwork: String!) {
              provisions(protocolNetwork: $protocolNetwork) {
                id
                dataService
                indexer
                tokensProvisioned
                tokensAllocated
                tokensThawing
                thawingPeriod
                maxVerifierCut
                protocolNetwork
                idleStake
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
        'tokensAllocated',
        'tokensThawing',
        'maxVerifierCut',
        'thawingPeriod',
      ]

      spinner.succeed('Provisions')
      printIndexerProvisions(
        print,
        outputFormat,
        result.data.provisions,
        displayProperties,
      )

      print.info('')
      print.info(
        `Indexer's idle stake: ${commify(
          formatGRT(result.data.provisions[0].idleStake),
        )} GRT`,
      )
      print.info(
        "To add this stake to the Subgraph Service provision, run 'graph indexer provision add <amount>'",
      )
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
