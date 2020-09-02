import path from 'path'
import { Argv } from 'yargs'
import {
  createLogger,
  connectContracts,
  createMetrics,
  createMetricsServer,
  SubgraphDeploymentID,
  createNetworkSubgraphClient,
} from '@graphprotocol/common-ts'
import { Wallet, providers } from 'ethers'
import { createServer } from '../server'
import { QueryProcessor } from '../queries'
import { NetworkMonitor } from '../network-monitor'

import knex from '@statechannels/server-wallet/lib/src/db/connection'
import { SigningWallet } from '@statechannels/server-wallet/lib/src/models/signing-wallet'
import { toAddress } from '../types'
import { ReceiptManager } from '../receipt-manager'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv): Argv => {
    return yargs
      .option('mnemonic', {
        describe: 'Ethereum wallet mnemonic',
        type: 'string',
        required: true,
      })
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
        required: true,
        group: 'Ethereum',
      })
      .option('port', {
        description: 'Port to serve from',
        type: 'number',
        default: 7600,
        group: 'Indexer Infrastructure',
      })
      .option('graph-node-query-endpoint', {
        description: 'Graph Node endpoint to forward queries to',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .option('graph-node-status-endpoint', {
        description: 'Graph Node endpoint for indexing statuses etc.',
        type: 'string',
        required: true,
        group: 'Indexer Infrastructure',
      })
      .option('free-query-auth-token', {
        description: 'Auth token that clients can use to query for free',
        type: 'array',
      })
      .option('network-subgraph-deployment', {
        description: 'Network subgraph deployment',
        type: 'string',
        group: 'Network Subgraph',
      })
      .option('network-subgraph-endpoint', {
        description: 'Endpoint to query the network subgraph from',
        type: 'string',
        group: 'Network Subgraph',
      })
      .check(argv => {
        if (!argv['network-subgraph-endpoint'] && !argv['network-subgraph-deployment']) {
          return `One of --network-subgraph-endpoint and --network-subgraph-deployment must be provided`
        }

        return true
      })
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: async (argv: { [key: string]: any } & Argv['argv']): Promise<void> => {
    const logger = createLogger({ name: 'IndexerService' })

    logger.info('Starting up...')

    logger.info('Connecting to Ethereum', { provider: argv.ethereum })
    let ethereum
    try {
      ethereum = new URL(argv.ethereum)
    } catch (e) {
      throw new Error(`Invalid Ethereum URL '${argv.ethereum}': ${e}`)
    }
    const web3 = new providers.JsonRpcProvider({
      url: ethereum.toString(),
      user: ethereum.username,
      password: ethereum.password,
    })
    const network = await web3.getNetwork()
    logger.info('Successfully connected to Ethereum', { provider: web3.connection.url })

    logger.info('Connect to contracts', {
      network: network.name,
      chainId: network.chainId,
    })
    const contracts = await connectContracts(web3, network.chainId)
    logger.info('Successfully to contracts')

    // Spin up a metrics server
    const metrics = createMetrics()
    createMetricsServer({
      logger: logger.child({ component: 'MetricsServer' }),
      registry: metrics.registry,
    })

    logger.info('Migrate server-wallet database')
    await knex.migrate.latest({
      loadExtensions: ['.js'],
      directory: path.resolve(
        require.resolve('@statechannels/server-wallet'),
        '..',
        '..',
        'db',
        'migrations',
      ),
    })
    logger.info('Successfully migrated server-wallet database')

    const wallet = Wallet.fromMnemonic(argv.mnemonic)

    const privateKey = wallet.privateKey
    // Ensure the address is checksummed
    const address = toAddress(wallet.address)
    await SigningWallet.query()
      .insert(SigningWallet.fromJson({ privateKey, address }))
      .catch(() => {
        // Ignore duplicate entry error; handle constraint violation by warning
        // the user that they already have a _different_ signing key below:
      })
      .finally(() => {
        logger.info('Seeded state channels wallet with account from mnemonic provided', {
          address,
        })
      })

    // Create payment manager
    const receiptManager = new ReceiptManager(
      logger.child({ component: 'ReceiptManager' }),
      privateKey,
    )

    const networkSubgraph = await createNetworkSubgraphClient({
      url: argv.networkSubgraphEndpoint
        ? argv.networkSubgraphEndpoint
        : new URL(
            `/subgraphs/id/${
              new SubgraphDeploymentID(argv.networkSubgraphDeployment).ipfsHash
            }`,
            argv.graphNodeQueryEndpoint,
          ).toString(),
    })

    // Create registered channel monitor
    const networkMonitor = new NetworkMonitor({
      logger: logger.child({ component: 'NetworkMonitor' }),
      wallet,
      networkSubgraph,
    })

    // Create a query processor for paid queries
    const queryProcessor = new QueryProcessor({
      logger: logger.child({ component: 'QueryProcessor' }),
      graphNode: argv.graphNodeQueryEndpoint,
      metrics,
      receiptManager,
      chainId: network.chainId,
      disputeManagerAddress: contracts.disputeManager.address,
    })

    // Spin up a basic webserver
    await createServer({
      logger: logger.child({ component: 'Server' }),
      port: argv.port,
      receiptManager,
      queryProcessor,
      metrics,
      graphNodeStatusEndpoint: argv.graphNodeStatusEndpoint,
      freeQueryAuthToken: argv.freeQueryAuthToken,
    })
  },
}
