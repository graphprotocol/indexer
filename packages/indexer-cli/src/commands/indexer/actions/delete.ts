import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {
  extractProtocolNetworkOption,
  extractSyncingNetworkOption,
  fixParameters,
} from '../../../command-helpers'
import { deleteActions, fetchActions } from '../../../actions'

const HELP = `
${chalk.bold('graph indexer actions delete')} [options] all
${chalk.bold('graph indexer actions delete')} [options] [<actionID1> ...]
${chalk.bold('graph indexer actions delete')} [options]

${chalk.dim('Options:')}

  -h, --help                                                        Show usage information
  -n, --network <networkName>                                       Filter by protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -s, --syncing <networkName>                                       Filter by the syncing network (see https://thegraph.com/networks/ for supported networks)
      --status  queued|approved|pending|success|failed|canceled     Filter by status
  -o, --output table|json|yaml                                      Choose the output format: table (default), JSON, or YAML 
`
function isNumber(value?: string | number): boolean {
  return value != null && value !== '' && !isNaN(Number(value.toString()))
}

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

    let protocolNetwork: string | undefined = undefined
    let syncingNetwork: string | undefined = undefined
    let deleteType: 'ids' | 'all' | 'filter' = 'filter'

    if (toHelp) {
      inputSpinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    try {
      protocolNetwork = extractProtocolNetworkOption(parameters.options)

      syncingNetwork = extractSyncingNetworkOption(parameters.options)

      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}", must be one of ['json', 'yaml', 'table']`,
        )
      }

      if (
        !status &&
        !syncingNetwork &&
        !protocolNetwork &&
        (!actionIDs || actionIDs.length === 0)
      ) {
        throw Error(
          `Required at least one argument: actionID(s), 'all', '--status' filter, '--network' filter, or '--syncing' filter`,
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

      if (actionIDs && actionIDs[0] == 'all') {
        deleteType = 'all'
        if (status || protocolNetwork || syncingNetwork || actionIDs.length > 1) {
          throw Error(
            `Invalid query, cannot specify '--status'|'--network'|'--syncing' filters or action ids in addition to 'action = all'`,
          )
        }
      }

      if (actionIDs && isNumber(actionIDs[0])) {
        deleteType = 'ids'
        if (status || protocolNetwork || syncingNetwork || actionIDs.length > 1) {
          throw Error(
            `Invalid query, cannot specify '--status'|'--network'|'--syncing' filters or action ids in addition to 'action = all'`,
          )
        }
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
      let numericActionIDs: number[] = []

      if (deleteType === 'all') {
        numericActionIDs = (await fetchActions(client, {})).map(action => action.id)
      } else if (deleteType === 'filter') {
        numericActionIDs = (
          await fetchActions(client, { status, protocolNetwork, syncingNetwork })
        ).map(action => action.id)
      } else if (deleteType === 'ids') {
        numericActionIDs = actionIDs.map(action => +action)
      }

      const numDeleted = await deleteActions(client, numericActionIDs)

      actionSpinner.succeed(`${numDeleted} actions deleted`)
    } catch (error) {
      actionSpinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
