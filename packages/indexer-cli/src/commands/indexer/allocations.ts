import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'allocations',
  alias: [],
  description: 'Manage indexer allocations',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'allocations'])
    process.exitCode = 1
  },
}
