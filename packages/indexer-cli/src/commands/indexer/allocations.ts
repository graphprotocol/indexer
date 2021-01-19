import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'allocations',
  alias: [],
  description: 'Manage subgraph allocations',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['allocations'])
    process.exitCode = -1
  },
}
