import { Argv } from 'yargs'
import { createLogger, SubgraphDeploymentID } from '@graphprotocol/common-ts'

import { startAgent } from '../agent'

export default {
  command: 'start',
  describe: 'Start the agent',
  builder: (yargs: Argv): Argv => {
    return yargs
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint for querying subgraphs',
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
      .options('indexer-geo-coordinates', {
        description: `Coordinates describing the Indexer's location using latitude and longitude`,
        type: 'array',
        default: ['31.780715', '-41.179504'],
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        required: true,
      })
      .option('connext-node', {
        description: 'Connext node URL',
        type: 'string',
        required: true,
      })
      .option('index-node-ids', {
        description: 'Node IDs of Graph nodes to use for indexing',
        type: 'string',
        array: true,
        required: true,
        coerce: arg =>
          arg.reduce(
            (acc: string[], value: string) => [...acc, ...value.split(',')],
            [],
          ),
      })
  },
  handler: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    argv: { [key: string]: any } & Argv['argv'],
  ): Promise<void> => {
    const logger = createLogger({ name: 'IndexerAgent' })

    await startAgent({
      mnemonic: argv.mnemonic,
      adminEndpoint: argv.graphNodeAdminEndpoint,
      statusEndpoint: argv.graphNodeStatusEndpoint,
      queryEndpoint: argv.graphNodeQueryEndpoint,
      publicIndexerUrl: argv.publicIndexerUrl,
      indexerGeoCoordinates: argv.indexerGeoCoordinates,
      ethereumProvider: argv.ethereum,
      network: argv.network,
      logger,
      networkSubgraphDeployment: new SubgraphDeploymentID(
        argv.networkSubgraphDeployment,
      ),
      connextNode: argv.connextNode,
      indexNodeIDs: argv.indexNodeIds,
    })
  },
}
