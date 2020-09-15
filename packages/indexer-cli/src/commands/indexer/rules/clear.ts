import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { partition } from '@thi.ng/iterators'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, validateDeploymentID } from '../../../command-helpers'
import {
  setIndexingRule,
  printIndexingRules,
  parseDeploymentID,
  parseIndexingRule,
} from '../../../rules'

const HELP = `
${chalk.bold('graph indexer rules clear')} [options] global          <key1> ...
${chalk.bold('graph indexer rules clear')} [options] <deployment-id> <key1> ...
${chalk.bold('graph indexer rules reset')} [options] global          <key1> ...
${chalk.bold('graph indexer rules reset')} [options] <deployment-id> <key1> ...

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'clear',
  alias: ['reset'],
  description: 'Clear one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [deployment, ...keys] = fixParameters(parameters, { h, help }) || []
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

    if (keys.length === 0) {
      print.error(`No keys provided for clearing`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    try {
      validateDeploymentID(deployment, { all: false })
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    // Turn the array into an object, add a `deployment` key
    const inputRule = parseIndexingRule({
      ...Object.fromEntries(
        partition(
          2,
          2,
          // indexing decisions cannot be null
          keys.map((key) => [key, key === 'decisionBasis' ? 'rules' : null]).flat(),
        ),
      ),
      deployment,
    })

    // Update the indexing rule according to the key/value pairs
    try {
      const client = await createIndexerManagementClient({ url: config.api })
      const rule = await setIndexingRule(client, inputRule)
      printIndexingRules(print, outputFormat, parseDeploymentID(deployment), rule, [])
    } catch (error) {
      print.error(error.toString())
    }
  },
}
