import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { costModel, costModels, parseDeploymentID, printCostModels } from '../../../cost'
import { validateDeploymentID } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer cost get')} [options] all
${chalk.bold('graph indexer cost get')} [options] <deployment-id>

${chalk.bold('graph indexer cost get')} [options] model all
${chalk.bold('graph indexer cost get')} [options] model <deployment-id>

${chalk.bold('graph indexer cost get')} [options] variables all
${chalk.bold('graph indexer cost get')} [options] variables <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get cost models and/or variables for one or all subgraphs',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, merged, o, output } = parameters.options
    const [first, second] = fixParameters(parameters, { h, help, merged }) || []
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

    const fields = ['model', 'variables'].includes(first)
      ? ['deployment', first]
      : ['deployment', 'model', 'variables']
    const rawDeployment = ['model', 'variables'].includes(first) ? second : first

    try {
      if (rawDeployment !== 'all') {
        await validateDeploymentID(rawDeployment)
      }
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

      printCostModels(print, outputFormat, deployment, costModelOrModels, fields)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
