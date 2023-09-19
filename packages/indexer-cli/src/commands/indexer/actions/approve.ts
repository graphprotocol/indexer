import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {
  fixParameters,
  printObjectOrArray,
  parseOutputFormat,
  extractProtocolNetworkOption,
} from '../../../command-helpers'
import { approveActions, fetchActions } from '../../../actions'
import { ActionStatus, resolveChainAlias } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer actions approve')} [options] [<actionID1> ...]
${chalk.bold('graph indexer actions approve')} [options] queued --network <networkName>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <STRING>        Filter action selection by their protocol network (mainnet, arbitrum-one, goerli, arbitrum-goerli)
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'approve',
  alias: [],
  description: 'Approve an action item',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const inputSpinner = toolbox.print.spin('Processing inputs')

    const { h, help, o, output } = parameters.options
    const [...actionIDs] = fixParameters(parameters, { h, help }) || []

    const outputFormat = parseOutputFormat(print, o || output || 'table')
    const toHelp = help || h || undefined

    if (toHelp) {
      inputSpinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    const protocolNetwork = extractProtocolNetworkOption(parameters.options)
    let numericActionIDs: number[]

    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      if (!actionIDs || actionIDs.length === 0) {
        throw Error(`Missing required argument: 'actionID'`)
      }

      // If actionIDs is 'queued', then populate actionIDs with actions that are queued
      if (actionIDs.join() == 'queued') {
        if (!protocolNetwork) {
          throw new Error(
            `Missing required option for approving queued actions: --network`,
          )
        }
        const queuedActions = await fetchActions(client, {
          status: ActionStatus.QUEUED,
          protocolNetwork,
        })

        numericActionIDs = queuedActions.map(action => action.id)
        if (numericActionIDs.length === 0) {
          throw Error(`No 'queued' actions found for network '${protocolNetwork}'`)
        }
      } else {
        numericActionIDs = actionIDs.map(action => +action)
      }

      // Ensure all provided actionIDs are positive numbers
      const invalidActionIDs: string[] = []
      numericActionIDs.forEach((id, index) => {
        if (isNaN(id) || id < 1) {
          invalidActionIDs.push(actionIDs[index])
        }
      })
      if (invalidActionIDs.length > 0) {
        throw Error(`Invaild action IDs: ${invalidActionIDs}`)
      }

      inputSpinner.succeed('Processed input parameters')
    } catch (error) {
      inputSpinner.fail(error.toString())
      print.info(HELP)
      process.exitCode = 1
      return
    }

    const actionSpinner = toolbox.print.spin(`Approving ${actionIDs.length} actions`)
    try {
      const queuedAction = await approveActions(client, numericActionIDs)

      // Format Actions 'protocolNetwork' field to display human-friendly chain aliases instead of CAIP2-IDs
      queuedAction.forEach(
        action => (action.protocolNetwork = resolveChainAlias(action.protocolNetwork)),
      )

      actionSpinner.succeed(`Actions approved`)
      printObjectOrArray(print, outputFormat, queuedAction, [
        'id',
        'type',
        'protocolNetwork',
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
