import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadConfig, writeConfig } from '../../config'

const HELP = `
${chalk.bold('graph indexer connect')} <url>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
`

module.exports = {
  name: 'connect',
  alias: [],
  description: 'Connect to indexer management API',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const { h, help } = toolbox.parameters.options
    const urlString = parameters.first

    if (help || h) {
      print.info(HELP)
      return
    }

    if (!urlString) {
      print.error('No indexer management API URL provided')
      print.info(HELP)
      process.exitCode = 1
      return
    }

    let url: URL
    try {
      url = new URL(urlString)
    } catch (e) {
      print.error(`Indexer management API URL "${urlString}" is invalid: ${e.message}`)
      process.exitCode = 1
      return
    }

    const config = loadConfig()
    config.api = url.toString()
    writeConfig(config)
  },
}
