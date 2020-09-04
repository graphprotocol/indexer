import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, validateDeploymentID } from '../../../command-helpers'
import {
  indexingRule,
  indexingRules,
  parseDeploymentID,
  printIndexingRules,
} from '../../../rules'
import { IndexingRuleAttributes } from '@graphprotocol/common-ts'

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
    const [rawDeployment, ...keys] = fixParameters(parameters, { h, help, merged }) || []
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
      validateDeploymentID(rawDeployment, { all: true })
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()
    const deployment = parseDeploymentID(rawDeployment)

    // Create indexer API client
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      const ruleOrRules =
        deployment === 'all'
          ? await indexingRules(client, !!merged)
          : await indexingRule(client, deployment, !!merged)

      printIndexingRules(
        print,
        outputFormat,
        deployment,
        ruleOrRules,
        keys as (keyof IndexingRuleAttributes)[],
      )
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
