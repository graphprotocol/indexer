import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'dips',
  alias: [],
  description: 'Manage DIPs (Direct Indexer Payments)',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['indexer', 'dips'])
    process.exitCode = 1
  },
}
