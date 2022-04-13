import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { partition } from '@thi.ng/iterators'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { parseIndexingRule, setIndexingRule, printIndexingRules } from '../../../rules'
import { processIdentifier } from '@graphprotocol/indexer-common'

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
    const [id, ...keyValues] = fixParameters(parameters, { h, help }) || []
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
      const [identifier, identifierType] = await processIdentifier(id, {
        all: false,
        global: true,
      })
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

      // Turn the array into an object, add `identifier` and `identifierType` keys
      const inputRule = parseIndexingRule({
        ...Object.fromEntries([...partition(2, 2, kvs)]),
        identifier,
        identifierType,
      })

      if (inputRule.parallelAllocations && inputRule.parallelAllocations >= 2) {
        print.error(
          'Parallel allocations are soon to be fully deprecated. Please set parallel allocations to 1 for all your indexing rules',
        )
        process.exitCode = 1
      }

      const client = await createIndexerManagementClient({ url: config.api })
      const rule = await setIndexingRule(client, inputRule)
      printIndexingRules(print, outputFormat, identifier, rule, [])
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
