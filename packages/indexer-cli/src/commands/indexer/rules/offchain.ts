import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {
  requireProtocolNetworkOption,
  fixParameters,
  parseOutputFormat,
} from '../../../command-helpers'
import { IndexingDecisionBasis, processIdentifier } from '@graphprotocol/indexer-common'
import { setIndexingRule, displayRules, parseIndexingRule } from '../../../rules'

const HELP = `
${chalk.bold('graph indexer rules offchain')}  [options] global
${chalk.bold('graph indexer rules offchain')}  [options] <subgraph-identifier>
${chalk.bold('graph indexer rules prepare')}   [options] global
${chalk.bold('graph indexer rules prepare')}   [options] <subgraph-identifier>

${chalk.dim('Options:')}

,  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'prepare',
  alias: ['offchain'],
  description: 'Offchain index a deployment (and start indexing it if necessary)',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [id] = fixParameters(parameters, { h, help }) || []
    const outputFormat = parseOutputFormat(print, o || output || 'table')

    if (help || h) {
      print.info(HELP)
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    try {
      const protocolNetwork = requireProtocolNetworkOption(parameters.options)
      const [identifier, identifierType] = await processIdentifier(id, {
        all: false,
        global: true,
      })

      const inputRule = parseIndexingRule({
        identifier,
        identifierType,
        protocolNetwork,
        decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      })

      // Update the indexing rule according to the key/value pairs
      const client = await createIndexerManagementClient({ url: config.api })
      const rule = await setIndexingRule(client, inputRule)
      print.info(displayRules(outputFormat, identifier, rule, []))
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
