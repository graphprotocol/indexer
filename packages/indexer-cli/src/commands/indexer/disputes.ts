import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'disputes',
  alias: [],
  description: 'Configure allocation POI monitoring',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'disputes'])
    process.exitCode = -1
  },
}
