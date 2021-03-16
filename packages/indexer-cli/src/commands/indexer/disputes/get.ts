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

    const config = loadValidatedConfig()

    // Create indexer API client
    const client = await createIndexerManagementClient({ url: config.api })
    try {
      const storedDisputes = await disputes(client)

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
