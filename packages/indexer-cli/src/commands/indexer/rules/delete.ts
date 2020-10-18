import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, validateDeploymentID } from '../../../command-helpers'
import { parseDeploymentID, indexingRules, deleteIndexingRules } from '../../../rules'
import { SubgraphDeploymentIDIsh } from 'indexer-cli/src/cost'

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
    const [deployment] = fixParameters(parameters, { h, help }) || []
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
      validateDeploymentID(deployment, { all: true, global: true })
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    // Update the indexing rule according to the key/value pairs
    try {
      const client = await createIndexerManagementClient({ url: config.api })
      const id = parseDeploymentID(deployment)
      if (id === 'all') {
        const rules = await indexingRules(client, false)
        await deleteIndexingRules(
          client,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          rules.map(rule => rule.deployment as SubgraphDeploymentIDIsh),
        )
        print.info(`Deleted all indexing rules`)
      } else if (id === 'global') {
        await deleteIndexingRules(client, ['global'])
        print.info(`Reset global indexing rules (the global rules cannot be deleted)`)
      } else {
        await deleteIndexingRules(client, [id])
        print.info(`Deleted indexing rules for deployment "${id.ipfsHash}`)
      }
    } catch (error) {
      print.error(error.toString())
      console.log(error)
    }
  },
}
