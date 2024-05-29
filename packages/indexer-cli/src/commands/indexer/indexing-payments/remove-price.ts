import chalk from 'chalk'
import { GluegunToolbox } from 'gluegun'
import { createIndexerManagementClient } from 'indexer-cli/src/client'
import { loadValidatedConfig } from 'indexer-cli/src/config'
import { removePrice } from 'indexer-cli/src/direct-indexer-payments'

const HELP = `
${chalk.bold(
  'graph indexer indexing-payments remove-price',
)} [options] <subgraphDeploymentId> <protocolNetwork>
`

export default {
  name: 'remove-price',
  alias: [],
  description: 'Remove a price for a subgraph deployment',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox
    const { h, help, subgraphDeploymentId, protocolNetwork } = parameters.options
    if (help || h) {
      print.info(HELP)
      return
    }
    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    await removePrice(
      {
        subgraphDeploymentId,
        protocolNetwork,
      },
      client,
    )
    console.log(`Price removed for subgraph deployment ${subgraphDeploymentId}`)
  },
}
