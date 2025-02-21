import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, parseOutputFormat } from '../../../command-helpers'
import { indexingRule, indexingRules, displayRules } from '../../../rules'
import { IndexingRuleAttributes, processIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer rules get')} [options] all             [<key1> ...]
${chalk.bold('graph indexer rules get')} [options] global          [<key1> ...]
${chalk.bold('graph indexer rules get')} [options] <deployment-id> [<key1> ...]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [id, ...keys] = fixParameters(parameters, { h, help }) || []
    const outputFormat = parseOutputFormat(print, o || output || 'table')

    if (help || h) {
      print.info(HELP)
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    try {
      const [identifier] = await processIdentifier(id ?? 'all', {
        all: true,
        global: true,
      })

      const config = loadValidatedConfig()

      // Create indexer API client
      const client = await createIndexerManagementClient({ url: config.api })

      let ruleOrRules
      if (identifier === 'all') {
        ruleOrRules = await indexingRules(client)
      } else {
        ruleOrRules = await indexingRule(client, identifier)
      }

      print.info(
        displayRules(
          outputFormat,
          identifier,
          ruleOrRules,
          keys as (keyof IndexingRuleAttributes)[],
        ),
      )
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
