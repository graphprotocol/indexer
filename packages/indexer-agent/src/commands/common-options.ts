import fs from 'fs'

import { Argv } from 'yargs'
import { parse as yaml_parse } from 'yaml'
import { parseDeploymentManagementMode } from '@graphprotocol/indexer-common'

// Injects all CLI options shared between this module's commands into a `yargs.Argv` object.
export function injectCommonStartupOptions(argv: Argv): Argv {
  argv
    .option('indexer-management-port', {
      description: 'Port to serve the indexer management API at',
      type: 'number',
      default: 8000,
      required: false,
      group: 'Indexer Infrastructure',
    })
    .option('metrics-port', {
      description: 'Port to serve Prometheus metrics at',
      type: 'number',
      default: 7300,
      required: false,
      group: 'Indexer Infrastructure',
    })
    .option('syncing-port', {
      description:
        'Port to serve the network subgraph and other syncing data for indexer service at',
      type: 'number',
      default: 8002,
      required: false,
      group: 'Indexer Infrastructure',
    })
    .option('log-level', {
      description: 'Log level',
      type: 'string',
      default: 'debug',
      group: 'Indexer Infrastructure',
    })
    .option('polling-interval', {
      description: 'Polling interval for data collection',
      type: 'number',
      required: false,
      default: 120_000,
      group: 'Indexer Infrastructure',
    })
    .option('offchain-subgraphs', {
      description: 'Subgraphs to index that are not on chain (comma-separated)',
      type: 'string',
      array: true,
      default: [],
      coerce: arg =>
        arg
          .reduce(
            (acc: string[], value: string) => [...acc, ...value.split(',')],
            [],
          )
          .map((id: string) => id.trim())
          .filter((id: string) => id.length > 0),
    })
    .option('postgres-host', {
      description: 'Postgres host',
      type: 'string',
      required: true,
      group: 'Postgres',
    })
    .option('postgres-port', {
      description: 'Postgres port',
      type: 'number',
      default: 5432,
      group: 'Postgres',
    })
    .option('postgres-username', {
      description: 'Postgres username',
      type: 'string',
      required: false,
      default: 'postgres',
      group: 'Postgres',
    })
    .option('postgres-password', {
      description: 'Postgres password',
      type: 'string',
      default: '',
      required: false,
      group: 'Postgres',
    })
    .option('postgres-sslenabled', {
      description: 'Postgres SSL Enabled',
      type: 'boolean',
      default: 'false',
      required: false,
      group: 'Postgres',
    })
    .option('postgres-database', {
      description: 'Postgres database name',
      type: 'string',
      required: true,
      group: 'Postgres',
    })
    .option('postgres-pool-size', {
      description: 'Postgres maximum connection pool size',
      type: 'number',
      default: 50,
      group: 'Postgres',
    })
    .option('ipfs-endpoint', {
      description: 'IPFS endpoint for querying manifests.',
      type: 'string',
      required: true,
      group: 'Indexer Infrastructure',
      default: 'https://ipfs.network.thegraph.com',
    })
    .option('enable-auto-graft', {
      description:
        'Automatically deploy and sync graft dependencies for subgraphs',
      type: 'boolean',
      required: false,
      group: 'Indexer Infrastructure',
      default: false,
    })
    .option('graph-node-query-endpoint', {
      description: 'Graph Node endpoint for querying subgraphs',
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
    .option('graph-node-admin-endpoint', {
      description:
        'Graph Node endpoint for applying and updating subgraph deployments',
      type: 'string',
      required: true,
      group: 'Indexer Infrastructure',
    })
    .option('enable-auto-migration-support', {
      description:
        'Auto migrate allocations from L1 to L2 (multi-network mode must be enabled)',
      type: 'boolean',
      required: false,
      default: false,
      group: 'Indexer Infrastructure',
    })
    .option('deployment-management', {
      describe: 'Subgraph deployments management mode',
      required: false,
      default: 'auto',
      choices: ['auto', 'manual'],
      coerce: parseDeploymentManagementMode,
      group: 'Indexer Infrastructure',
    })
    .config({
      key: 'config-file',
      description: 'Indexer agent configuration file (YAML format)',
      parseFn: function (cfgFilePath: string) {
        return yaml_parse(fs.readFileSync(cfgFilePath, 'utf-8'))
      },
    })
    .check(argv => {
      // Unset arguments set to empty strings.
      // This can happen when users set their options as enviroment variables and don't
      // assign any value to them.
      //
      // For example:
      // ```sh
      // export INDEXER_AGENT_OFFCHAIN_SUBGRAPHS=
      // export INDEXER_AGENT_OFFCHAIN_SUBGRAPHS=
      // ```
      //
      // In NodeJs, those enviroment variables will be set as an empty string instead of
      // being undefined, which can cause parse errors when the Agent is building a
      // NetworkSpecification.
      for (const [key, value] of Object.entries(argv)) {
        if (value === '') {
          delete argv[key]
        }
      }
      return true
    })

  return argv
}
