import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'provision',
  alias: [],
  description: "Manage indexer's provision",
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'provision'])
    process.exitCode = 1
  },
}
