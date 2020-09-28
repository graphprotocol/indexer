import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { partition } from '@thi.ng/iterators'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, validateDeploymentID } from '../../../command-helpers'
import {
  parseIndexingRule,
  setIndexingRule,
  printIndexingRules,
  parseDeploymentID,
} from '../../../rules'

const HELP = `
${chalk.bold('graph indexer rules set')} [options] global          <key1> <value1> ...
${chalk.bold('graph indexer rules set')} [options] <deployment-id> <key1> <value1> ...

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'set',
  alias: [],
  description: 'Set one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [deployment, ...keyValues] = fixParameters(parameters, { h, help }) || []
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
      validateDeploymentID(deployment, { all: false, global: true })
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    //// Parse key/value pairs

    // 1. Convert all `null` strings to real nulls, and other values
    //    to regular JS strings (which for some reason they are not...)
    const kvs = keyValues.map(param => (param === 'null' ? null : param.toString()))

    // 2. Check that all key/value pairs are complete and
    // there's no value missing at the end
    if (kvs.length % 2 !== 0) {
      print.error(`An uneven number of key/value pairs was passed in: ${kvs.join(' ')}`)
      process.exitCode = 1
      return
    }

    // Turn the array into an object, add a `deployment` key
    const inputRule = parseIndexingRule({
      ...Object.fromEntries([...partition(2, 2, kvs)]),
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
