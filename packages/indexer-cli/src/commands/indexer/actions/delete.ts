import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters } from '../../../command-helpers'
import { deleteActions, fetchActions } from '../../../actions'

const HELP = `
${chalk.bold('graph indexer actions delete')} [options] all
${chalk.bold('graph indexer actions delete')} [options] [<actionID1> ...]

${chalk.dim('Options:')}

  -h, --help                                                        Show usage information
      --status  queued|approved|pending|success|failed|canceled     Filter by status
  -o, --output table|json|yaml                                      Choose the output format: table (default), JSON, or YAML 
`

module.exports = {
  name: 'delete',
  alias: [],
  description: 'Delete one or many actions in the queue',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const inputSpinner = toolbox.print.spin('Processing inputs')

    const { status, h, help, o, output } = parameters.options
    const [...actionIDs] = fixParameters(parameters, { h, help }) || []

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined

    if (toHelp) {
      inputSpinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    try {
      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}", must be one of ['json', 'yaml', 'table']`,
        )
      }

      if (
        status &&
        !['queued', 'approved', 'pending', 'success', 'failed', 'canceled'].includes(
          status,
        )
      ) {
        throw Error(
          `Invalid '--status' provided, must be one of ['queued', 'approved', 'pending', 'success', 'failed', 'canceled]`,
        )
      }

      if (actionIDs[0] == 'all') {
        if (status || actionIDs.length > 1) {
          throw Error(
            `Invalid query, cannot specify '--status' filter or multiple ids in addition to 'action = all'`,
          )
        }
      }

      if (!status && (!actionIDs || actionIDs.length === 0)) {
        throw Error(
          `Required at least one argument: actionID(s), 'all', or '--status' filter`,
        )
      }

      inputSpinner.succeed('Processed input parameters')
    } catch (error) {
      inputSpinner.fail(error.toString())
      print.info(HELP)
      process.exitCode = 1
      return
    }

    const actionSpinner = toolbox.print.spin(`Deleting ${actionIDs.length} actions`)
    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const numericActionIDs: number[] =
        actionIDs[0] == 'all'
          ? (await fetchActions(client, {})).map(action => action.id)
          : status
          ? (await fetchActions(client, { status })).map(action => action.id)
          : actionIDs.map(action => +action)

      const numDeleted = await deleteActions(client, numericActionIDs)

      actionSpinner.succeed(`${numDeleted} actions deleted`)
    } catch (error) {
      actionSpinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
