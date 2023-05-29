import * as yargs from 'yargs'
import { inspect } from 'util'
import { specification as spec } from '@graphprotocol/indexer-common'
import {
  start,
  createNetworkSpecification,
  AgentOptions,
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

async function processArguments(
  args: AgentOptions,
): Promise<spec.NetworkSpecification[]> {
  if (args['_'].includes('start')) {
    const specification = await createNetworkSpecification(args)
    return [specification]
  } else if (args['_'].includes('start-multiple')) {
    return parseNetworkSpecifications(args)
  }
  // Should be unreachable
  throw new Error('Bad invocation')
}

async function main(): Promise<void> {
  const args = parseArguments()
  const specs = await processArguments(args)
  console.log(inspect(specs, { colors: true }))
}

main()
