import * as yargs from 'yargs'

import start from './commands/start'

yargs
  .scriptName('indexer-agent')
  .env('INDEXER_AGENT')
  .command(start)
  .fail(function (msg, err, yargs) {
    if (err) {
      console.error(err)
    } else {
      console.error(msg)
      console.error(`
Usage help...
`)
      console.error(yargs.help())
    }
    process.exit(1)
  })
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv
