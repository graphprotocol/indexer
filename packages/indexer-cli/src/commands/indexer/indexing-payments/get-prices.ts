import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadValidatedConfig } from 'indexer-cli/src/config'
import { createIndexerManagementClient } from 'indexer-cli/src/client'
import gql from 'graphql-tag'

const HELP = `
${chalk.bold('graph indexer indexing-payments get-prices')} [options]

${chalk.dim('Options:')}
    -h, --help        Show usage information
`

export default {
  name: 'get-prices',
  alias: [],
  description: 'Get all prices',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox
    const { h, help } = parameters.options
    if (help || h) {
      print.info(HELP)
      return
    }
    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    const prices = await client.query(gql`
      query {
        prices {
          subgraphDeploymentID
          price
          protocolNetwork
        }
      }
    `)
    console.log(prices)
  },
}
