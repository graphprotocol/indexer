import { build } from 'gluegun'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (argv: any) => {
  const cli = build()
    .brand('graph-indexer')
    .help()
    .version()
    .src(__dirname)
    .defaultCommand()
    .create()

  return await cli.run(argv)
}

module.exports = { run }
