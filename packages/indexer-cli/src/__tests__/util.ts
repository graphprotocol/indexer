import { exec, ExecOptions } from 'child_process'
import { Wallet } from 'ethers'
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
  IndexingStatusResolver,
  NetworkSubgraph,
} from '@graphprotocol/indexer-common'
import {
  connectContracts,
  connectDatabase,
  createLogger,
  Logger,
  NetworkContracts,
  parseGRT,
  toAddress,
} from '@graphprotocol/common-ts'

declare const __DATABASE__: never
declare const __LOG_LEVEL__: never

let defaultMaxEventListeners: number
let sequelize: Sequelize
let models: IndexerManagementModels
let wallet: Wallet
let address: string
let contracts: NetworkContracts
let logger: Logger
let indexerManagementClient: IndexerManagementClient
let server: http.Server
let sockets: Socket[] = []

export const setup = async () => {
  logger = createLogger({
    name: 'Indexer CLI tester',
    async: false,
    level: __LOG_LEVEL__,
  })

  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  address = '0x3C17A4c7cD8929B83e4705e04020fA2B1bca2E55'
  contracts = await connectContracts(wallet, 4)
  await sequelize.sync({ force: true })

  wallet = Wallet.createRandom()

  const statusEndpoint = 'http://localhost:8030/graphql'
  const indexingStatusResolver = new IndexingStatusResolver({
    logger: logger,
    statusEndpoint,
  })

  const networkSubgraph = await NetworkSubgraph.create({
    logger,
    endpoint: 'https://gateway.testnet.thegraph.com/network',
    deployment: undefined,
  })
  const indexNodeIDs = ['node_1']
  indexerManagementClient = await createIndexerManagementClient({
    models,
    address: toAddress(address),
    contracts: contracts,
    indexingStatusResolver,
    indexNodeIDs,
    deploymentManagementEndpoint: statusEndpoint,
    networkSubgraph,
    logger,
    defaults: {
      globalIndexingRule: {
        allocationAmount: parseGRT('1000'),
        parallelAllocations: 1,
      },
    },
    features: {
      injectDai: false,
    },
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
  process.on('SIGTERM', await shutdownIndexerManagementServer)
  process.on('SIGINT', await shutdownIndexerManagementServer)

  // Set global, deployment, and subgraph based test rules and cost model
  const commands: string[][] = [
    ['indexer', 'connect', 'http://localhost:18000'],
    ['indexer', 'rules', 'set', 'global', 'minSignal', '500', 'allocationAmount', '.01'],
    ['indexer', 'rules', 'set', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
    ['indexer', 'rules', 'prepare', 'QmZfeJYR86UARzp9HiXbURWunYgC9ywvPvoePNbuaATrEK'],
    [
      'indexer',
      'rules',
      'set',
      '0x0000000000000000000000000000000000000000-0',
      'allocationAmount',
      '1000',
    ],
    ['indexer', 'rules', 'offchain', '0x0000000000000000000000000000000000000000-1'],
    [
      'indexer',
      'rules',
      'set',
      '0x0000000000000000000000000000000000000000-2',
      'allocationAmount',
      '1000',
      'decisionBasis',
      'offchain',
      'allocationLifetime',
      '12',
    ],
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
    const { exitCode } = await runIndexerCli(command, process.cwd())
    if (exitCode == 1) {
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
