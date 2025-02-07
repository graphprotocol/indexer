import { createLogger } from '@graphprotocol/common-ts'
import * as yargs from 'yargs'
import {
  start,
  createNetworkSpecification,
  reviewArgumentsForWarnings,
  AgentOptions,
  run,
} from './commands/start'
import { parseNetworkSpecification } from '@graphprotocol/indexer-common'

function parseArguments(): AgentOptions {
  let builder = yargs.scriptName('indexer-agent').env('INDEXER_AGENT')

  // Dynamic argument parser construction based on network mode
  console.log('Starting the Indexer Agent')
  builder = builder.command(start)

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

  let specification
  if (args.dir || args['network-specifications-directory']) {
    specification = parseNetworkSpecification(args, logger)
  } else {
    specification = await createNetworkSpecification(args, logger)
    reviewArgumentsForWarnings(args, logger)
  }
  await run(args, specification!, logger)
}

async function main(): Promise<void> {
  const args = parseArguments()
  await processArgumentsAndRun(args)
}

void main()
