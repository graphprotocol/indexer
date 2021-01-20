import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'beta',
  alias: [],
  description: 'Experimental indexer commands',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['beta'])
    process.exitCode = -1
  },
}
