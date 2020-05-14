import { Argv } from 'yargs'
import { logging } from '@graphprotocol/common-ts'

import { Agent } from '../agent'
import { AgentConfig } from '../types'

export default {
  command: 'start',
  describe: 'Start the agent',
  builder: (yargs: Argv) => {
    return yargs
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string'
      })
      .option('graph-node-admin-endpoint', {
        description: 'Graph Node endpoint for applying and updating subgraph deployments',
        type: 'string'
      })
      .option('mnemonic', {
        description: 'Mnemonic for the wallet',
        type: 'string'
      })
      .demandOption(['graph-node-status-endpoint', 'graph-node-admin-endpoint', 'mnemonic'])
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerAgent' })

    logger.info('Starting up agent...')
    let config: AgentConfig = {
      mnemonic: argv.mnemonic,
      adminEndpoint: argv.graphNodeAdminEndpoint,
      statusEndpoint: argv.graphNodeStatusEndpoint,
      logger: logger
    }
    let agent = new Agent(config)
    await agent.start()
  },
}
