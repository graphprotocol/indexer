import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, validateDeploymentID } from '../../../command-helpers'
import { costModel, costModels, parseDeploymentID, printCostModels } from '../../../cost'

const HELP = `
${chalk.bold('graph indexer cost get')} [options] all
${chalk.bold('graph indexer cost get')} [options] <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get one or more cost models',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, merged, o, output } = parameters.options
    const [rawDeployment] = fixParameters(parameters, { h, help, merged }) || []
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
      validateDeploymentID(rawDeployment, { all: true, global: false })
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
      const costModelOrModels =
        deployment === 'all'
          ? await costModels(client)
          : await costModel(client, deployment)

      printCostModels(print, outputFormat, deployment, costModelOrModels)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
