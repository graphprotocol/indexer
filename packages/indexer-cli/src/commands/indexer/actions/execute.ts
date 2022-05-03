import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, printObjectOrArray } from '../../../command-helpers'
import { executeApprovedActions } from '../../../actions'

const HELP = `
${chalk.bold('graph indexer actions execute approved')} [options]

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML 
`

module.exports = {
  name: 'execute',
  alias: [],
  description: 'Execute approved items in the action queue',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Execute approved actions')

    const { h, help, o, output } = parameters.options

    const [type] = fixParameters(parameters, { h, help }) || []

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined

    if (toHelp) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      process.exitCode = 1
      return
    }

    if (!['approved'].includes(type)) {
      spinner.fail(`Invalid action type '${type}', must be one of ['approved']`)
      process.exitCode = 1
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      spinner.fail(
        `Invalid output format "${outputFormat}", must be one of ['json', 'yaml', 'table']`,
      )
      print.info(HELP)
      process.exitCode = 1
      return
    }

    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const executedActions = await executeApprovedActions(client)

      spinner.succeed(`Executed approved actions`)

      printObjectOrArray(print, outputFormat, executedActions, [
        'id',
        'status',
        'type',
        'deploymentID',
        'allocationID',
        'amount',
        'poi',
        'force',
        'priority',
        'transaction',
        'failureReason',
        'source',
        'reason',
      ])
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
