import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { IndexingDecisionBasis, processIdentifier } from '@graphprotocol/indexer-common'
import { setIndexingRule, printIndexingRules, parseIndexingRule } from '../../../rules'

const HELP = `
${chalk.bold('graph indexer rules maybe')} [options] global
${chalk.bold('graph indexer rules maybe')} [options] <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'maybe',
  alias: [],
  description: 'Index a deployment based on rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [id] = fixParameters(parameters, { h, help }) || []
    const outputFormat = o || output || 'table'

    if (help || h) {
      print.info(HELP)
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      print.error(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    try {
      const [identifier, identifierType] = await processIdentifier(id, {
        all: false,
        global: true,
      })

      const inputRule = parseIndexingRule({
        identifier,
        identifierType,
        decisionBasis: IndexingDecisionBasis.RULES,
      })

      const client = await createIndexerManagementClient({ url: config.api })
      const rule = await setIndexingRule(client, inputRule)
      printIndexingRules(print, outputFormat, identifier, rule, [])
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
