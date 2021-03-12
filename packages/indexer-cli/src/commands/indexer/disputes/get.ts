import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {disputes, printDisputes} from '../../../disputes'

const HELP = `
${chalk.bold('graph indexer disputes get')} [options] all
${chalk.bold('graph indexer disputes get')} [options] <status>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
      --merged                  Shows the deployment rules and global rules merged
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'Get one or more indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help, o, output } = parameters.options


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

    // 1. convert status to Status type (command-helpers.ts)

    // 2. fetch all POIs with that status

    // 3. format and return results or return message indicating nothing found
    //
    // try {
    //   validateDeploymentID(rawDeployment, { all: true, global: true })
    // } catch (error) {
    //   print.error(error.toString())
    //   process.exitCode = 1
    //   return
    // }

    const config = loadValidatedConfig()

    // Create indexer API client
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      console.log('jifjiofjdiojiosf')
      const storedDisputes = await disputes(client)

      console.log('stored dispys', storedDisputes)
      printDisputes(
        print,
        outputFormat,
        storedDisputes,
      )
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
