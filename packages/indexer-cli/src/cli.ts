import { build } from 'gluegun'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const run = async (argv: any) => {
  const cli = build()
    .brand('graph-indexer')
    .help()
    .version()
    .src(__dirname)
    .defaultCommand()
    .create()

  return await cli.run(argv)
}
