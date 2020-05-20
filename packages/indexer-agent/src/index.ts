import * as yargs from 'yargs'

yargs
  .scriptName('indexer-agent')
  .env('INDEXER_AGENT')
  .command(require('./commands/start').default)
  .fail(function(msg, err, yargs) {
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
