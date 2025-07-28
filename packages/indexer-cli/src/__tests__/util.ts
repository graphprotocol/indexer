import { exec, ExecOptions } from 'child_process'
import fs from 'fs'
import http from 'http'
import { Socket } from 'net'
import { URL } from 'url'
import path from 'path'
import { Sequelize } from 'sequelize'
import {
  ActionStatus,
  ActionType,
  createIndexerManagementClient,
  createIndexerManagementServer,
  defineIndexerManagementModels,
  defineQueryFeeModels,
  GraphNode,
  IndexerManagementClient,
  IndexerManagementDefaults,
  IndexerManagementModels,
  IndexingDecisionBasis,
  loadTestYamlConfig,
  MultiNetworks,
  Network,
  QueryFeeModels,
  specification,
  SubgraphIdentifierType,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  parseGRT,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import cloneDeep from 'lodash.clonedeep'

const INDEXER_SAVE_CLI_TEST_OUTPUT: boolean =
  !!process.env.INDEXER_SAVE_CLI_TEST_OUTPUT &&
  process.env.INDEXER_SAVE_CLI_TEST_OUTPUT.toLowerCase() !== 'false'

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

const yamlObj = loadTestYamlConfig()
const testNetworkSpecification = specification.NetworkSpecification.parse(yamlObj)

// Replace strip-ansi with a simple function using the same regex pattern
// Based on ansi-regex v6.1.0 pattern
function stripAnsi(str: string): string {
  if (typeof str !== 'string') {
    throw new TypeError(`Expected a string, got ${typeof str}`)
  }

  // Regex pattern from ansi-regex
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
  ].join('|')

  return str.replace(new RegExp(pattern, 'g'), '')
}

export const setupMultiNetworks = async () => {
  return await setup(true)
}

export const setupSingleNetwork = async () => {
  return await setup(false)
}

export const setup = async (multiNetworksEnabled: boolean) => {
  logger = createLogger({
    name: 'Setup',
    async: false,
    level: __LOG_LEVEL__,
  })
  logger.info('Setup test infrastructure - indexer-cli')

  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()

  sequelize = await sequelize.sync({ force: true })

  const statusEndpoint = 'http://127.0.0.1:8030/graphql'
  const graphNode = new GraphNode(
    logger,
    'http://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    statusEndpoint,
    'https://test-ipfs-endpoint.xyz',
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
  )

  const fakeMainnetNetwork = cloneDeep(network) as Network
  fakeMainnetNetwork.specification.networkIdentifier = 'eip155:1'

  const multiNetworks = multiNetworksEnabled
    ? new MultiNetworks(
        [network, fakeMainnetNetwork],
        (n: Network) => n.specification.networkIdentifier,
      )
    : new MultiNetworks([network], (n: Network) => n.specification.networkIdentifier)

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

  await connect()
}

// Simply setup connection config
export const connect = async () => {
  const command = ['indexer', 'connect', 'http://127.0.0.1:18000']
  const { exitCode, stderr, stdout } = await runIndexerCli(command, process.cwd())
  if (exitCode == 1) {
    console.error(stderr)
    console.log(stdout)
    throw Error(`Setup failed: indexer rules or cost set command failed: ${command}`)
  }
}

export const seedIndexingRules = async () => {
  logger = createLogger({
    name: 'Seed',
    async: false,
    level: __LOG_LEVEL__,
  })

  try {
    // Seed IndexingRule table
    logger.debug('Seed IndexingRules')
    await models.IndexingRule.create({
      id: 1,
      identifier: 'global',
      identifierType: SubgraphIdentifierType.GROUP,
      protocolNetwork: 'eip155:421614',
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
      allocationAmount: parseGRT('0.01').toString(),
      minSignal: parseGRT('500').toString(),
    })
    await models.IndexingRule.create({
      id: 2,
      identifier: 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      protocolNetwork: 'eip155:421614',
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
    })
    await models.IndexingRule.create({
      id: 3,
      identifier: 'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      protocolNetwork: 'eip155:421614',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
    })
    await models.IndexingRule.create({
      id: 4,
      identifier: '0x0000000000000000000000000000000000000000-0',
      identifierType: SubgraphIdentifierType.SUBGRAPH,
      protocolNetwork: 'eip155:421614',
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
      allocationAmount: parseGRT('1000').toString(),
    })
    await models.IndexingRule.create({
      id: 5,
      identifier: '0x0000000000000000000000000000000000000000-1',
      identifierType: SubgraphIdentifierType.SUBGRAPH,
      protocolNetwork: 'eip155:421614',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
    })
    await models.IndexingRule.create({
      id: 6,
      identifier: '0x0000000000000000000000000000000000000000-2',
      identifierType: SubgraphIdentifierType.SUBGRAPH,
      protocolNetwork: 'eip155:421614',
      allocationAmount: parseGRT('1000').toString(),
      allocationLifetime: 12,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: true,
      safety: true,
      autoRenewal: true,
    })
  } catch (e) {
    logger.error('Failed to seed DB', { error: e })
    process.exit(1)
  }
}

export const seedCostModels = async () => {
  logger = createLogger({
    name: 'Seed IndexingRules',
    async: false,
    level: __LOG_LEVEL__,
  })
  try {
    // Seed CostModel table
    logger.debug('Seed CostModels')
    await models.CostModel.create({
      deployment: 'global',
      model: 'default => 0.00025;',
    })
    await models.CostModel.create({
      deployment: new SubgraphDeploymentID(
        'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK',
      ).toString(),
      model: 'default => 0.00025;',
    })
  } catch (e) {
    logger.error('Failed to seed CostModel table', { error: e })
    process.exit(1)
  }
}

export const seedActions = async () => {
  logger = createLogger({
    name: 'Seed Actions',
    async: false,
    level: __LOG_LEVEL__,
  })

  try {
    // Seed Action table
    logger.debug('Seed Actions')
    await models.Action.create({
      id: 1,
      type: ActionType.ALLOCATE,
      status: ActionStatus.SUCCESS,
      deploymentID: 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q',
      source: 'test',
      reason: 'test',
      protocolNetwork: 'eip155:421614',
      isLegacy: false,
    })
    await models.Action.create({
      id: 2,
      type: ActionType.UNALLOCATE,
      status: ActionStatus.FAILED,
      deploymentID: 'QmSrf6VVPyg9NGdS1xhLmoosk3qZQaWhfoSTHE2H7sht6Q',
      source: 'test',
      reason: 'test',
      protocolNetwork: 'eip155:421614',
      isLegacy: false,
    })
  } catch (e) {
    logger.error('Failed to seed ', { error: e })
    process.exit(1)
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

      if (INDEXER_SAVE_CLI_TEST_OUTPUT) {
        // To aid debugging, persist the output of CLI test commands for reviewing potential issues when tests fail.
        // Requires setting the environment variable INDEXER_SAVE_CLI_TEST_OUTPUT.
        const outfile = outputReferencePath.replace('references/', '')
        const prefix = `/tmp/indexer-cli-test`
        if (stdout) {
          fs.writeFile(`${prefix}-${outfile}.stdout`, stripAnsi(stdout), 'utf8', err => {
            err ? console.error('test: %s, error: %s', outfile, err) : null
          })
        }
        if (stderr) {
          fs.writeFile(`${prefix}-${outfile}.stderr`, stripAnsi(stderr), 'utf8', err => {
            err ? console.error('test: %s, error: %s', outfile, err) : null
          })
        }
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
