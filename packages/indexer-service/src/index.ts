#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import * as startCommand from './commands/start'

yargs(hideBin(process.argv))
  .scriptName('indexer-service')
  .env('INDEXER_SERVICE')
  .command(startCommand)
  .demandCommand(1, 'Choose a command from the above list')
  .help().argv
