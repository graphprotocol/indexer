import { createLogger } from '@graphprotocol/common-ts'
import * as yargs from 'yargs'
import {
  start,
  createNetworkSpecification,
  reviewArgumentsForWarnings,
  AgentOptions,
  run,
} from './commands/start'
import {
  startMultiNetwork,
  parseNetworkSpecifications,
} from './commands/start-multi-network'
import process from 'node:process'

const MULTINETWORK_MODE: boolean =
  !!process.env.INDEXER_AGENT_MULTINETWORK_MODE &&
  process.env.INDEXER_AGENT_MULTINETWORK_MODE.toLowerCase() !== 'false'

function parseArguments(): AgentOptions {
  let builder = yargs.scriptName('indexer-agent').env('INDEXER_AGENT')

  // Dynamic argument parser construction based on network mode
  if (MULTINETWORK_MODE) {
    console.log('Starting the Indexer Agent in multi-network mode')
    builder = builder.command(startMultiNetwork)
  } else {
    console.log('Starting the Indexer Agent in single-network mode')
    builder = builder.command(start)
  }

  return (
    builder
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .fail(function (msg, err, _yargs) {
        console.error('The Indexer Agent command has failed.')
        if (err) {
          console.error(err)
        } else {
          console.error(msg)
        }
        process.exit(1)
      })
      .demandCommand(
        1,
        'You need at least one command before continuing.' +
          " See 'indexer-agent --help' for usage instructions.",
      )
      .help().argv
  )
}

async function processArgumentsAndRun(args: AgentOptions): Promise<void> {
  const logger = createLogger({
    name: 'IndexerAgent',
    async: false,
    level: args.logLevel,
  })
  if (MULTINETWORK_MODE) {
    const specifications = parseNetworkSpecifications(args, logger)
    await run(args, specifications, logger)
  } else {
    reviewArgumentsForWarnings(args, logger)
    const specification = await createNetworkSpecification(args, logger)
    await run(args, [specification], logger)
  }
}

async function main(): Promise<void> {
  const args = parseArguments()
  await processArgumentsAndRun(args)
}

const exceptionLogger = createLogger({
  name: 'IndexerAgent',
  async: false,
})

process.on('uncaughtException', (reason, promise) => {
  exceptionLogger.error('Uncaught exception', {
    reason,
    promise,
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  exceptionLogger.error('Unhandled rejection', {
    reason,
    promise,
  })
  process.exit(1)
})

void main()
