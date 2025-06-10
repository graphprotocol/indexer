import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import {
  Action,
  ActionFilter,
  ActionUpdateInput,
  resolveChainAlias,
} from '@graphprotocol/indexer-common'
import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, printObjectOrArray } from '../../../command-helpers'
import {
  buildActionFilter,
  parseActionUpdateInput,
  updateActions,
} from '../../../actions'
import { partition } from '@thi.ng/iterators'

const HELP = `
${chalk.bold('graph indexer actions update')} [options] [<key1> <value1> ...]

${chalk.dim('Options:')}

  -h, --help                                                                Show usage information
      --id          <actionID>                                                    Filter by actionID
      --type        allocate|unallocate|reallocate                                Filter by type
      --status      queued|approved|deploying|pending|success|failed|canceled     Filter by status
      --source      <source>                                                      Filter by source
      --reason      <reason>                                                      Filter by reason string
  -o, --output      table|json|yaml                                               Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'update',
  alias: [],
  description: 'Update one or more actions',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const inputSpinner = toolbox.print.spin('Processing inputs')

    const { id, type, status, source, reason, h, help, o, output } = parameters.options

    const [...setValues] = fixParameters(parameters, { h, help }) || []
    let updateActionInput: ActionUpdateInput = {}
    let actionFilter: ActionFilter = {}

    const outputFormat = o || output || 'table'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (help || h) {
      inputSpinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }
    try {
      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}" must be one of ['json', 'yaml' or 'table']`,
        )
      }

      // 1. Convert all `null` strings to real nulls, and other values
      //    to regular JS strings (which for some reason they are not...)
      const kvs = setValues.map(param => (param === 'null' ? null : param.toString()))

      // 2. Check that all key/value pairs are complete and
      // there's no value missing at the end
      if (kvs.length % 2 !== 0) {
        throw Error(`An uneven number of key/value pairs was passed in: ${kvs.join(' ')}`)
      }

      updateActionInput = parseActionUpdateInput({
        ...Object.fromEntries([...partition(2, 2, kvs)]),
      })

      actionFilter = buildActionFilter(id, type, status, source, reason)

      inputSpinner.succeed('Processed input parameters')
    } catch (error) {
      inputSpinner.fail(error.toString())
      print.info(HELP)
      process.exitCode = 1
      return
    }

    const actionSpinner = toolbox.print.spin('Updating actions')

    try {
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const actionsUpdated = await updateActions(client, actionFilter, updateActionInput)

      if (!actionsUpdated || actionsUpdated.length === 0) {
        print.info('No actions found')
        process.exitCode = 1
        return
      }

      actionSpinner.succeed(`'${actionsUpdated.length}' actions updated`)

      const displayProperties: (keyof Action)[] = [
        'id',
        'type',
        'protocolNetwork',
        'deploymentID',
        'allocationID',
        'amount',
        'poi',
        'publicPOI',
        'poiBlockNumber',
        'force',
        'priority',
        'status',
        'source',
        'failureReason',
        'transaction',
        'reason',
        'isLegacy',
      ]

      // Format Actions 'protocolNetwork' field to display human-friendly chain aliases instead of CAIP2-IDs
      actionsUpdated.forEach(
        action => (action.protocolNetwork = resolveChainAlias(action.protocolNetwork)),
      )

      printObjectOrArray(print, outputFormat, actionsUpdated, displayProperties)
    } catch (error) {
      actionSpinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
