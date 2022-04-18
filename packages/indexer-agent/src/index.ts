import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import start from './commands/start'

yargs(hideBin(process.argv))
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
