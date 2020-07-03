import * as yargs from 'yargs'

import start from './commands/start'

yargs
  .scriptName('indexer-service')
  .env('INDEXER_SERVICE')
  .command(start)
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv
