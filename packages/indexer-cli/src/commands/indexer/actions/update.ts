import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import {
  parseBoolean,
  Action,
  ActionResult,
  ActionType,
  ActionStatus,
  ActionUpdateParams,
} from '@graphprotocol/indexer-common'
import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { fixParameters, printObjectOrArray, validatePOI } from '../../../command-helpers'
import { updateActions } from '../../../actions'
const HELP = `
${chalk.bold('graph indexer actions update')} [options]
${chalk.bold('graph indexer actions update')} [options] <--filter id:id>
${chalk.bold('graph indexer actions update')} [options] <--filter id:all>

${chalk.dim('Options:')}

  -h, --help                                                        Show usage information
      --filter  id|type|status|source                               Filter by fields
      --type    allocate|unallocate|reallocate|collect              Update type
      --status  queued|approved|pending|success|failed|canceled     Update status
      --amount <amount>                                             Update amount
      --poi    <poi>                                                Update POI
      --force   true|false                                          Update force
      --first [N]                                                   Fetch only the N first records (default: all records)
  -o, --output table|json|yaml                                      Choose the output format: table (default), JSON, or YAML


`

module.exports = {
  name: 'update',
  alias: [],
  description: 'Update one or more actions',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const inputSpinner = toolbox.print.spin('Processing inputs')

    const { filter, type, status, amount, poi, force, h, help, o, output, first } =
      parameters.options

    fixParameters(parameters, { h, help }) || []
    const outputFormat = o || output || 'table'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let filters: any = {}
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

      // Parse filters
      //TODO: right now if filter isn't provided then everything is updated
      // Do we want to limit this so there must be at least 1 filter?
      if (filter) {
        if (filter instanceof Array) {
          // better to update this transformation to objects
          filters = Object.fromEntries(filter.map(f => f.split(':')))
        } else {
          filters = Object.fromEntries([filter.split(':')])
        }

        Object.entries(filters).forEach(([k, v]) => {
          switch (k) {
            case 'type':
              if (!['allocate', 'unallocate', 'reallocate'].includes(v as string)) {
                throw Error(
                  `Invalid 'ActionType' "${v}", must be one of ['allocate', 'unallocate', 'reallocate']`,
                )
              }
              break
            case 'status':
              if (
                ![
                  'queued',
                  'approved',
                  'pending',
                  'success',
                  'failed',
                  'canceled',
                ].includes(v as string)
              ) {
                throw Error(
                  `Invalid 'status' ${v} provided, must be one of ['queued', 'approved', 'pending', 'success', 'failed', 'canceled]`,
                )
              }

              break
            case 'source':
              // any source can be a group
              break
            case 'reason':
              // any reason can be a group
              break
            // case 'failureReason':
            //   if (!k.match(`IE0..`)) {
            //     throw Error(
            //       `Invalid '--filter reason:___' provided, must be one of Indexer error code (IE0..)`,
            //     )
            //   }
            //   break
            case 'id':
              if (v !== 'all' && isNaN(+(v as string))) {
                throw Error(
                  `Invalid 'actionID' provided ('${v}'), must be a numeric id or 'all'`,
                )
              }
              if (v == 'all') {
                if (filters.type || filters.reason) {
                  throw Error(
                    `Invalid query, cannot specify 'type', 'status', 'source' or 'reason' filters in addition to 'action:all'`,
                  )
                }
              }
              filters.id = +(v as string)

              break
            default: {
              throw Error(
                `Invalid '--filter' provided, must be one of ['type', 'status', 'source', 'reason', 'id']`,
              )
            }
          }
        })
      }

      // Check update field validity
      if (type && !['allocate', 'unallocate', 'reallocate'].includes(type)) {
        throw Error(
          `Invalid 'ActionType' "${type}", must be one of ['allocate', 'unallocate', 'reallocate']`,
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

      if (poi) {
        if (!(await validatePOI(poi))) {
          throw Error(`Invalid '--poi' provided`)
        }
      }

      if (amount && +amount < 0) {
        throw Error(`Invalid '--amount' provided, must be at least 0`)
      }

      if (!['undefined', 'number'].includes(typeof first)) {
        throw Error(`Invalid value for '--first' option, must have a numeric value.`)
      }

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

      const updateActionItem: ActionUpdateParams = {
        type: type
          ? ActionType[type.toUpperCase() as keyof typeof ActionType]
          : undefined,
        status: status
          ? ActionStatus[status.toUpperCase() as keyof typeof ActionStatus]
          : undefined,
        reason: `manual update`,
        amount,
        poi: await validatePOI(poi),
        force: parseBoolean(force),
      }

      if (!updateActionItem) {
        throw new Error(`Could not parse action update information`)
      }

      // Query filtered actions
      let actions: ActionResult[] = []
      switch (filters.id) {
        case `all`: {
          actions = await updateActions(client, {}, updateActionItem, first)
          break
        }
        case `^[1-9]\\d*$`: {
          actions = await updateActions(
            client,
            { id: +filters.id },
            updateActionItem,
            first,
          )
          break
        }
        default: {
          actions = await updateActions(client, filters, updateActionItem, first)
        }
      }
      actionSpinner.succeed('Actions query returned')

      if (!actions || actions.length === 0) {
        print.info('No actions found')
        process.exitCode = 1
        return
      }

      const displayProperties: (keyof Action)[] = [
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
        'failureReason',
        'transaction',
        'reason',
      ]

      printObjectOrArray(print, outputFormat, actions, displayProperties)
    } catch (error) {
      actionSpinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
