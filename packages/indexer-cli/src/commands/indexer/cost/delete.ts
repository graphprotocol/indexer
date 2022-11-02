import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { costModels, deleteCostModels, parseDeploymentID } from '../../../cost'
import { CostModelAttributes } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer cost delete')} [options] all
${chalk.bold('graph indexer cost delete')} [options] global
${chalk.bold('graph indexer cost delete')} [options] <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'delete',
  alias: [],
  description: 'Remove one or many cost models',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options
    const [rawDeployment] = fixParameters(parameters, { h, help }) || []
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
      const config = loadValidatedConfig()
      // Create indexer API client
      const client = await createIndexerManagementClient({ url: config.api })
      const deployment = parseDeploymentID(rawDeployment)
      switch (deployment) {
        case 'all': {
          const deployments: string[] = (await costModels(client))
            .filter((model): model is CostModelAttributes => !!model.deployment)
            .map(model => model.deployment.toString())

          const numberDeleted = await deleteCostModels(client, deployments)
          print.success(
            `Deleted ${numberDeleted} cost model(s) for: \n${deployments.join('\n')}`,
          )
          break
        }
        case 'global': {
          await deleteCostModels(client, [deployment])
          print.success(`Deleted cost model for ${deployment}`)
          break
        }
        default: {
          await deleteCostModels(client, [deployment.bytes32])
          print.success(`Deleted cost model for ${rawDeployment}`)
        }
      }
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
      return
    }
  },
}
