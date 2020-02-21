import { stateChannels } from '@graphprotocol/common-ts'
import * as yargs from 'yargs'

yargs
  .scriptName('indexer-service')
  .env('INDEXER_SERVICE')
  .command(require('./commands/start').default)
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv
