import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'indexing-payments',
  alias: [],
  description: 'Setup direct indexing payment prices.',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'indexing-payments'])
    process.exitCode = -1
  },
}
