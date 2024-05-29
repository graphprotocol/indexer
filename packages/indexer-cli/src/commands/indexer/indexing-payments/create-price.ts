import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadValidatedConfig } from 'indexer-cli/src/config'
import { createIndexerManagementClient } from 'indexer-cli/src/client'
import { createPrice } from 'indexer-cli/src/direct-indexer-payments'

const HELP = `
${chalk.bold('graph indexer indexing-payments create-price')} [options]

${chalk.dim('Options:')}
    -h, --help        Show usage information
    --subgraphDeploymentId        Subgraph deployment ID
    --protocolNetwork              Protocol network
    --pricePerBlock                Price per block
`

export default {
  name: 'create-price',
  description: 'Create a price for a subgraph deployment',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox
    const { h, help, subgraphDeploymentId, protocolNetwork, pricePerBlock } =
      parameters.options
    if (help || h) {
      print.info(HELP)
      return
    }
    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    await createPrice(
      {
        subgraphDeploymentId,
        protocolNetwork,
        pricePerBlock,
      },
      client,
    )
    console.log(`Price created for subgraph deployment ${subgraphDeploymentId}`)
  },
}
