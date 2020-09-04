import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'indexer',
  alias: [],
  description: 'Manage indexing rules',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer'])
    process.exitCode = -1
  },
}
