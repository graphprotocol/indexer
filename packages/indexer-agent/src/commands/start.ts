import { Argv } from 'yargs'
import { logging } from '@graphprotocol/common-ts'

import { Agent } from '../agent'
import { AgentConfig } from '../types'

export default {
  command: 'start',
  describe: 'Start the agent',
  builder: (yargs: Argv) => {
    return yargs
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
      })
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string',
        required: true,
      })
      .option('graph-node-admin-endpoint', {
        description:
          'Graph Node endpoint for applying and updating subgraph deployments',
        type: 'string',
        required: true,
      })
      .option('public-indexer-url', {
        description: 'Indexer endpoint for receiving requests from the network',
        type: 'string',
        required: true,
      })
      .option('network', {
        description:
          'Ethereum network where the protocol contracts are deployed',
        type: 'string',
        choices: ['ganache', 'kovan', 'mainnet', 'ropsten'],
        default: 'ropsten',
      })
      .option('mnemonic', {
        description: 'Mnemonic for the wallet',
        type: 'string',
        required: true,
      })
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerAgent' })

    logger.info('Starting up agent...')
    let config: AgentConfig = {
      mnemonic: argv.mnemonic,
      adminEndpoint: argv.graphNodeAdminEndpoint,
      statusEndpoint: argv.graphNodeStatusEndpoint,
      publicIndexerUrl: argv.publicIndexerUrl,
      ethereumProvider: argv.ethereum,
      network: argv.network,
      logger: logger,
    }
    let agent = new Agent(config)
    await agent.start()
  },
}
