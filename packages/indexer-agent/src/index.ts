import * as yargs from 'yargs'

yargs
  .scriptName('indexer-agent')
  .env('INDEXER_AGENT')
  .command(require('./commands/start').default)
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv
