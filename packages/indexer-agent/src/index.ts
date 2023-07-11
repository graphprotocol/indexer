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

function parseArguments(): AgentOptions {
  return yargs
    .scriptName('indexer-agent')
    .env('INDEXER_AGENT')
    .command(start)
    .command(startMultiNetwork)
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
}

async function processArgumentsAndRun(args: AgentOptions): Promise<void> {
  const logger = createLogger({
    name: 'IndexerAgent',
    async: false,
    level: args.logLevel,
  })
  if (args['_'].includes('start')) {
    reviewArgumentsForWarnings(args, logger)
    const specification = await createNetworkSpecification(args)
    await run(args, [specification], logger)
  } else if (args['_'].includes('start-multiple')) {
    const specifications = parseNetworkSpecifications(args)
    await run(args, specifications, logger)
  } else {
    throw new Error('Invalid command line usage for Indexer Agent')
  }
}

async function main(): Promise<void> {
  const args = parseArguments()
  await processArgumentsAndRun(args)
  // console.log(inspect(specs, { colors: true }))
}

main()
