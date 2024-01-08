import process from 'process'
import * as yargs from 'yargs'

import start from './commands/start'
import { createLogger } from '@graphprotocol/common-ts'

yargs
  .scriptName('indexer-service')
  .env('INDEXER_SERVICE')
  .command(start)
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv

const exceptionLogger = createLogger({
  name: 'IndexerService',
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
