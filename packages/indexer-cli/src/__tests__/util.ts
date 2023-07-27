import { exec, ExecOptions } from 'child_process'
import fs from 'fs'
import http from 'http'
import { Socket } from 'net'
import { URL } from 'url'
import path from 'path'
import { Sequelize } from 'sequelize'
import stripAnsi from 'strip-ansi'
import {
  createIndexerManagementClient,
  createIndexerManagementServer,
  defineIndexerManagementModels,
  IndexerManagementClient,
  IndexerManagementModels,
  GraphNode,
  specification,
  IndexerManagementDefaults,
  Network,
  MultiNetworks,
  QueryFeeModels,
  defineQueryFeeModels,
} from '@graphprotocol/indexer-common'
import {
  createMetrics,
  Metrics,
  connectDatabase,
  createLogger,
  Logger,
  parseGRT,
} from '@graphprotocol/common-ts'

declare const __DATABASE__: never
declare const __LOG_LEVEL__: never

let defaultMaxEventListeners: number
let sequelize: Sequelize
let models: IndexerManagementModels
let queryFeeModels: QueryFeeModels
let logger: Logger
let indexerManagementClient: IndexerManagementClient
let server: http.Server
let sockets: Socket[] = []
let metrics: Metrics

const PUBLIC_JSON_RPC_ENDPOINT = 'https://ethereum-goerli.publicnode.com'

const testProviderUrl =
  process.env.INDEXER_TEST_JRPC_PROVIDER_URL ?? PUBLIC_JSON_RPC_ENDPOINT

export const testNetworkSpecification = specification.NetworkSpecification.parse({
  networkIdentifier: 'goerli',
  gateway: {
    url: 'http://localhost:8030/',
  },
  networkProvider: {
    url: testProviderUrl,
  },
  indexerOptions: {
    address: '0xf56b5d582920E4527A818FBDd801C0D80A394CB8',
    mnemonic:
      'famous aspect index polar tornado zero wedding electric floor chalk tenant junk',
    url: 'http://test-indexer.xyz',
  },
  subgraphs: {
    networkSubgraph: {
      url: 'https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli',
    },
    epochSubgraph: {
      url: 'http://test-url.xyz',
    },
  },
  transactionMonitoring: {
    gasIncreaseTimeout: 240000,
    gasIncreaseFactor: 1.2,
    baseFeePerGasMax: 100 * 10 ** 9,
    maxTransactionAttempts: 0,
  },
  dai: {
    contractAddress: '0x4e8a4C63Df58bf59Fef513aB67a76319a9faf448',
    inject: false,
  },
})

export const setup = async () => {
  logger = createLogger({
    name: 'Indexer CLI tester',
    async: false,
    level: __LOG_LEVEL__,
  })

  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()

  sequelize = await sequelize.sync({ force: true })

  const statusEndpoint = 'http://localhost:8030/graphql'
  const indexNodeIDs = ['node_1']
  const graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
    indexNodeIDs,
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
  )

  const multiNetworks = new MultiNetworks(
    [network],
    (n: Network) => n.specification.networkIdentifier,
  )

  const defaults: IndexerManagementDefaults = {
    globalIndexingRule: {
      allocationAmount: parseGRT('100'),
      parallelAllocations: 1,
      requireSupported: true,
      safety: true,
    },
  }

  indexerManagementClient = await createIndexerManagementClient({
    models,
    graphNode,
    indexNodeIDs,
    logger,
    defaults,
    multiNetworks,
  })

  server = await createIndexerManagementServer({
    logger,
    client: indexerManagementClient,
    port: 18000,
  })
  server.on('connection', socket => {
    logger.debug('Connection established', { socket })
    sockets.push(socket)
    socket.on('close', () => (sockets = sockets.filter(curr => curr !== socket)))
  })

  defaultMaxEventListeners = process.getMaxListeners()
  process.setMaxListeners(100)
  process.on('SIGTERM', shutdownIndexerManagementServer)
  process.on('SIGINT', shutdownIndexerManagementServer)
}

// Set global, deployment, and subgraph based test rules and cost model
export const seed = async () => {
  const commands: string[][] = [
    ['indexer', 'connect', 'http://localhost:18000'],
    [
      'indexer',
      'rules',
      'set',
      '--network',
      'goerli',
      'global',
      'minSignal',
      '500',
      'allocationAmount',
      '.01',
    ],
    [
      'indexer',
      'rules',
      'set',
      '--network',
      'goerli',
      'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
    ],
    [
      'indexer',
      'rules',
      'prepare',
      '--network',
      'goerli',
      'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
    ],
    [
      'indexer',
      'rules',
      'set',
      '--network',
      'goerli',
      '0x0000000000000000000000000000000000000000-0',
      'allocationAmount',
      '1000',
    ],
    [
      'indexer',
      'rules',
      'offchain',
      '--network',
      'goerli',
      '0x0000000000000000000000000000000000000000-1',
    ],
    [
      'indexer',
      'rules',
      'set',
      '--network',
      'goerli',
      '0x0000000000000000000000000000000000000000-2',
      'allocationAmount',
      '1000',
      'decisionBasis',
      'offchain',
      'allocationLifetime',
      '12',
    ],
    ['indexer', 'cost', 'set', 'model', 'global', 'src/__tests__/references/basic.agora'],
    [
      'indexer',
      'cost',
      'set',
      'model',
      'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
      'src/__tests__/references/basic.agora',
    ],
    [
      'indexer',
      'cost',
      'set',
      'variables',
      'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
      `'{"DAI": "0.5"}'`,
    ],
  ]
  for (const command of commands) {
    const { exitCode, stderr, stdout } = await runIndexerCli(command, process.cwd())
    if (exitCode == 1) {
      console.error(stderr)
      console.log(stdout)
      throw Error(`Setup failed: indexer rules or cost set command failed: ${command}`)
    }
  }
}

export const shutdownIndexerManagementServer = async () => {
  logger.debug('Received kill signal, shutting down gracefully')
  server.close(() => {
    logger.debug('Closed out remaining connections')
  })
  sockets.forEach(curr => curr.destroy())
}

export const dropSequelizeModels = async () => {
  await sequelize.drop({})
}

export const teardown = async () => {
  process.setMaxListeners(defaultMaxEventListeners)
  await shutdownIndexerManagementServer()
  await dropSequelizeModels()
}

export const deleteFromAllTables = async () => {
  const queryInterface = sequelize.getQueryInterface()
  const allTables = await queryInterface.showAllTables()
  await Promise.all(allTables.map(tableName => queryInterface.bulkDelete(tableName, {})))
}

export interface CommandResult {
  exitCode: number | null
  stdout: string | undefined
  stderr: string | undefined
}

const resolvePath = (p: string): string => path.join(__dirname, p)

interface CommandTestOptions extends ExecOptions {
  expectedExitCode?: number | undefined
}

export const cliTest = (
  title: string,
  args: string[],
  outputReferencePath: string,
  options: CommandTestOptions,
) => {
  test(
    title,
    async () => {
      const cwd = options.cwd ? options.cwd : resolvePath(``)
      const expectedExitCode = options.expectedExitCode
      let expectedStdout: string | undefined
      let expectedStderr: string | undefined
      try {
        expectedStdout = fs.readFileSync(
          resolvePath(`./${outputReferencePath}.stdout`),
          'utf-8',
        )
      } catch (e) {
        expectedStdout = undefined
      }
      try {
        expectedStderr = fs.readFileSync(
          resolvePath(`./${outputReferencePath}.stderr`),
          'utf-8',
        )
      } catch (e) {
        expectedStderr = undefined
      }

      const { exitCode, stdout, stderr } = await runIndexerCli(args, cwd)
      if (expectedStdout == undefined && expectedStderr == undefined) {
        throw new Error(
          `No matching expected stdout or expected stderr found for the '${title}' test. ` +
            `Make sure there is least one expected output located at the defined 'outputReferencePath', '${outputReferencePath}'`,
        )
      }
      // TEMPORARY DEGBUG
      const outfile = outputReferencePath.replace('references/', '')
      if (stdout) {
        fs.writeFile(`/tmp/idx-${outfile}.stdout`, stripAnsi(stdout), 'utf8', err => {
          err ? console.error('test: %s, error: %s', outfile, err) : null
        })
      }
      if (stderr) {
        fs.writeFile(`/tmp/idx-${outfile}.stderr`, stripAnsi(stderr), 'utf8', err => {
          err ? console.error('test: %s, error: %s', outfile, err) : null
        })
      }

      if (expectedExitCode !== undefined) {
        if (exitCode == undefined) {
          throw new Error('Expected exitCode (found undefined)')
        }
        expect(exitCode).toBe(expectedExitCode)
      }

      if (expectedStderr) {
        if (stderr == undefined) {
          throw new Error('Expected stderr (found undefined)')
        }
        // For some reason the error sometimes comes in stdout, then
        // stderr comes empty.
        //
        // If that's the case, we should throw it so it's easier
        // to debug the error.
        //
        // TODO: investigate why that happens (somewhere it should
        // be using console.error or print.error for example) so this
        // check can be removed.
        if (stderr.length === 0 && stdout && stdout.length !== 0) {
          expect(stripAnsi(stdout)).toBe(expectedStderr)
        } else {
          expect(stripAnsi(stderr)).toBe(expectedStderr)
        }
      }
      if (expectedStdout) {
        if (stdout == undefined) {
          throw new Error('Expected stdout (found undefined)')
        }
        expect(stripAnsi(stdout)).toBe(expectedStdout)
      }
    },
    options.timeout || undefined,
  )
}

const runIndexerCli = async (
  args: string[] = [],
  cwd: string | URL | undefined = process.cwd(),
): Promise<CommandResult> => {
  if (cwd instanceof URL) {
    cwd = cwd.href
  }
  cwd = cwd[0] !== '/' ? path.resolve(__dirname, cwd) : cwd

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const command = path.join(__dirname, '..', '..', 'bin', 'graph-indexer')
    const child = exec(`${command} ${args.join(' ')}`, { cwd })

    child.on('error', error => {
      reject(error)
    })

    child.stdout?.on('data', data => {
      stdout += data.toString()
    })

    child.stderr?.on('data', data => {
      stderr += data.toString()
    })

    child.on('exit', exitCode => {
      resolve({ exitCode, stdout, stderr })
    })
  })
}
