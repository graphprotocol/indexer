import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { partition } from '@thi.ng/iterators'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, suggestCommands } from '../../../command-helpers'
import {
  parseIndexingRule,
  setIndexingRule,
  printIndexingRules,
  indexingRule,
} from '../../../rules'
import { processIdentifier } from '@graphprotocol/indexer-common'
import { stringify } from 'yaml'

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
      const client = await createIndexerManagementClient({ url: config.api })

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

      // Turn input into an indexing rule object, add `identifier` and `identifierType` keys
      try {
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
        const rule = await setIndexingRule(client, inputRule)
        printIndexingRules(print, outputFormat, identifier, rule, [])
      } catch (error) {
        // Failed to parse input, make suggestions
        // Generate a instance of indexing rules for valid attributes
        const tmpRules = await indexingRule(client, 'global', false)
        if (!tmpRules) {
          throw new Error(
            `Global indexing rules missing, try again after the agent ensures global rule`,
          )
        }
        const valid_commands = Object.keys(tmpRules).filter(
          c => c != 'parallelAllocations',
        )
        throw new Error(
          `Indexing rule attribute '${error.message}' not supported, did you mean?\n` +
            stringify(suggestCommands(error.message, valid_commands)).replace(/\n$/, ''),
        )
      }
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
