import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { partition } from '@thi.ng/iterators'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { setIndexingRule, printIndexingRules, parseIndexingRule } from '../../../rules'
import { processIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer rules clear')} [options] global          [<key1> ...]
${chalk.bold('graph indexer rules clear')} [options] <subgraph-identifier> [<key1> ...]
${chalk.bold('graph indexer rules reset')} [options] global          [<key1> ...]
${chalk.bold('graph indexer rules reset')} [options] <subgraph-identifier> [<key1> ...]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML

${chalk.dim('Hints:')}

  * If no keys are provided, all keys are reset.
`

module.exports = {
  name: 'clear',
  alias: ['reset'],
  description: 'Clear one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [id, ...keys] = fixParameters(parameters, { h, help }) || []
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

    // Clear all keys if none are provided
    if (keys.length === 0) {
      keys.push(
        'allocationAmount',
        'allocationLifetime',
        'autoRenewal',
        'parallelAllocations',
        'minSignal',
        'maxSignal',
        'minStake',
        'maxAllocationPercentage',
        'minAverageQueryFees',
        'decisionBasis',
        'custom',
        'requireSupported',
      )
    }

    const config = loadValidatedConfig()

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [identifier, identifierType] = await processIdentifier(id, {
        all: false,
        global: true,
      })

      // Turn the array into an object, add an `identifier` key
      const inputRule = parseIndexingRule({
        ...Object.fromEntries(
          partition(
            2,
            2,
            // indexing decisions cannot be null
            keys.map(key => [key, key === 'decisionBasis' ? 'rules' : null]).flat(),
          ),
        ),
        identifier,
        identifierType,
        autoRenewal: true,
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
