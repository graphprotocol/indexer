import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { indexingRule, indexingRules, printIndexingRules } from '../../../rules'
import { IndexingRuleAttributes, processIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer rules get')} [options] all             [<key1> ...]
${chalk.bold('graph indexer rules get')} [options] global          [<key1> ...]
${chalk.bold('graph indexer rules get')} [options] <deployment-id> [<key1> ...]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
      --merged                  Shows the deployment rules and global rules merged
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, merged, o, output } = parameters.options
    const [id, ...keys] = fixParameters(parameters, { h, help, merged }) || []
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

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [identifier, identifierType] = await processIdentifier(id, {
        all: true,
        global: true,
      })

      const config = loadValidatedConfig()

      // Create indexer API client
      const client = await createIndexerManagementClient({ url: config.api })

      const ruleOrRules =
        identifier === 'all'
          ? await indexingRules(client, !!merged)
          : await indexingRule(client, identifier, !!merged)

      printIndexingRules(
        print,
        outputFormat,
        identifier,
        ruleOrRules,
        keys as (keyof IndexingRuleAttributes)[],
      )
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
