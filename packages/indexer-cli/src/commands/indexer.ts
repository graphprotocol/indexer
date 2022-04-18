import { GluegunToolbox } from 'gluegun'

export default {
  name: 'indexer',
  alias: [],
  description: 'Manage indexer configuration',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer'])
    process.exitCode = -1
  },
}
