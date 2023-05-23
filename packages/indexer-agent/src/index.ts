import * as yargs from 'yargs'

import start from './commands/start'
import startMultiNetwork from './commands/start-multi-network'

const args = yargs
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

console.log(args)
