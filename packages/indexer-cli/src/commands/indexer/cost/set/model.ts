import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import fs from 'fs'

import { loadValidatedConfig } from '../../../../config'
import { createIndexerManagementClient } from '../../../../client'
import { fixParameters } from '../../../../command-helpers'
import {
  parseCostModel,
  parseDeploymentID,
  printCostModels,
  setCostModel,
} from '../../../../cost'
import { validateDeploymentID } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer cost set model')} [options] <deployment-id> <file>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'model',
  alias: [],
  description: 'Update a cost model',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, merged, o, output } = parameters.options
    const [deployment, filename] = fixParameters(parameters, { h, help, merged }) || []
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
      await validateDeploymentID(deployment)
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }

    let model = null
    try {
      model = fs.readFileSync(filename, 'utf8').trim()
    } catch (error) {
      print.error(`Failed to load cost model from "${filename}": ${error.message}`)
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()
    let costModel = parseCostModel({
      deployment,
      model,
      variables: null,
    })

    try {
      const client = await createIndexerManagementClient({ url: config.api })
      costModel = await setCostModel(client, costModel)
      printCostModels(print, outputFormat, parseDeploymentID(deployment), costModel, [])
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
