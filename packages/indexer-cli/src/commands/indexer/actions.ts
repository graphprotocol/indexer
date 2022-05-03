import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'actions',
  alias: [],
  description: 'Manage indexer actions',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'actions'])
    process.exitCode = 1
  },
}
