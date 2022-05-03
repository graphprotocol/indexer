import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { printObjectOrArray } from '../../../command-helpers'
import { buildActionInput, queueActions } from '../../../actions'
import { ActionInput, ActionStatus, ActionType } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold(
  'graph indexer actions queue',
)} [options] <ActionType> <targetDeployment> <param1> <param2> <param3> <param4>
${chalk.bold('graph indexer actions queue')} [options] allocate <deploymentID> <amount>
${chalk.bold(
  'graph indexer actions queue',
)} [options] unallocate <deploymentID> <allocationID> <poi> <force>
${chalk.bold(
  'graph indexer actions queue',
)} [options] reallocate <deploymentID> <allocationID> <amount> <poi> <force>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML 
  -s, --source <STRING>         Specify the source of the action decision
  -r, --reason <STRING>         Specify the reason for the action to be taken
  -p, --priority <INT>          Define a priority order for the action
`

module.exports = {
  name: 'queue',
  alias: [],
  description: 'Queue an action item',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const inputSpinner = toolbox.print.spin('Processing inputs')

    const defaultSource = 'indexerCLI'
    const defaultReason = 'manual'
    const defaultPriority = 0

    const { h, help, o, output, s, source, r, reason, p, priority } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined
    const decisionSource = source || s || defaultSource
    const decisionReason = reason || r || defaultReason
    const executionPriority = priority || p || defaultPriority

    if (toHelp) {
      inputSpinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    const [type, targetDeployment, param1, param2, param3, param4] =
      parameters.array || []

    let actionInputParams: ActionInput
    try {
      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}", must be one of ['json', 'yaml', 'table']`,
        )
      }

      if (!['allocate', 'unallocate', 'reallocate'].includes(type)) {
        throw Error(
          `Invalid 'ActionType' "${type}", must be one of ['allocate', 'unallocate', 'reallocate']`,
        )
      }

      actionInputParams = await buildActionInput(
        ActionType[type.toUpperCase() as keyof typeof ActionType],
        { targetDeployment, param1, param2, param3, param4 },
        decisionSource,
        decisionReason,
        ActionStatus.QUEUED,
        executionPriority,
      )

      inputSpinner.succeed(`Processed input parameters`)
    } catch (error) {
      inputSpinner.fail(error.toString())
      print.info(HELP)
      process.exitCode = 1
      return
    }

    const actionSpinner = toolbox.print.spin(
      `Queueing ${type} action, target: ${targetDeployment}`,
    )
    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const queuedAction = await queueActions(client, [actionInputParams])

      actionSpinner.succeed(`${type} action added to queue`)

      printObjectOrArray(print, outputFormat, queuedAction, [
        'id',
        'type',
        'deploymentID',
        'allocationID',
        'amount',
        'poi',
        'force',
        'priority',
        'status',
        'source',
        'reason',
      ])
    } catch (error) {
      actionSpinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
