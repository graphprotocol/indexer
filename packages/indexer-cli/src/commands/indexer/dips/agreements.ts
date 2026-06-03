import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'agreements',
  alias: [],
  description: 'Manage DIPs indexing agreements',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'dips', 'agreements'])
    process.exitCode = 1
  },
}
