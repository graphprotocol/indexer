import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../../config'
import { createIndexerManagementClient } from '../../../../client'
import { fixParameters, validateDeploymentID } from '../../../../command-helpers'
import {
  parseCostModel,
  parseDeploymentID,
  printCostModels,
  setCostModel,
} from '../../../../cost'

const HELP = `
${chalk.bold(
  'graph indexer cost set variables',
)} [options] <deployment-id> <variables-json>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'variables',
  alias: [],
  description: 'Update cost model variables',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, merged, o, output } = parameters.options
    const [deployment, variables] = fixParameters(parameters, { h, help, merged }) || []
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
      validateDeploymentID(deployment, { all: false, global: false })
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    try {
      JSON.parse(variables)
    } catch (error) {
      print.error(`Variables are not valid JSON: ${variables}`)
      process.exitCode = 1
      return
    }

    const parsedVariables = JSON.parse(variables)
    if (typeof parsedVariables !== 'object' || Array.isArray(parsedVariables)) {
      print.error(`Variables must be a JSON object: ${variables}`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()
    let costModel = parseCostModel({
      deployment,
      model: null,
      variables,
    })

    try {
      const client = await createIndexerManagementClient({ url: config.api })
      costModel = await setCostModel(client, costModel)
      printCostModels(print, outputFormat, parseDeploymentID(deployment), costModel, [])
    } catch (error) {
      print.error(error.toString())
    }
  },
}
