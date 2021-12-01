import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { indexingRules, deleteIndexingRules } from '../../../rules'
import { SubgraphDeploymentIDIsh } from 'indexer-cli/src/cost'
import { processIdentifier } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer rules delete')} [options] all
${chalk.bold('graph indexer rules delete')} [options] global
${chalk.bold('graph indexer rules delete')} [options] <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'delete',
  description: 'Remove one or many indexing rules',
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
      const [identifier, identifierType] = await processIdentifier(id, { all: false, global: true })

      const client = await createIndexerManagementClient({ url: config.api })

      if (identifier === 'all') {
        const rules = await indexingRules(client, false)
        await deleteIndexingRules(
          client,
          rules.map(rule => rule.identifier as SubgraphDeploymentIDIsh),
        )
        print.info(`Deleted all indexing rules`)
      } else if (identifier === 'global') {
        await deleteIndexingRules(client, ['global'])
        print.info(`Reset global indexing rules (the global rules cannot be deleted)`)
      } else {
        await deleteIndexingRules(client, [identifier as SubgraphDeploymentIDIsh])
        print.info(`Deleted indexing rules for "${identifier}" (${identifierType})`)
      }
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
