import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import { loadValidatedConfig } from 'indexer-cli/src/config'
import { createIndexerManagementClient } from 'indexer-cli/src/client'
import { createPrice } from 'indexer-cli/src/direct-indexer-payments'

const HELP = `
${chalk.bold('graph indexer indexing-payments create-price')} [options]

${chalk.dim('Options:')}
    -h, --help        Show usage information
    --pricePerBlock                Price per block
    --chainId                      Chain Id - EIP 155 
    --protocolNetwork              Protocol network - EIP 155
`

export default {
  name: 'create-price',
  description: 'Create a price for a subgraph deployment',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox
    const { h, help, pricePerBlock, chainId, protocolNetwork } = parameters.options
    if (help || h) {
      print.info(HELP)
      return
    }
    const config = loadValidatedConfig()
    const client = await createIndexerManagementClient({ url: config.api })
    await createPrice(
      {
        id: 0,
        pricePerBlock,
        protocolNetwork,
        chainId,
      },
      client,
    )
    console.log(`Price created (${pricePerBlock}/block) for chainId ${chainId}`)
  },
}
