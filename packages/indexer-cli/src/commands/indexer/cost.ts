import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'cost',
  alias: [],
  description: 'Manage costing for subgraphs',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['cost'])
    process.exitCode = -1
  },
}
