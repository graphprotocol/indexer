import { GluegunToolbox } from 'gluegun'

module.exports = {
  name: 'rules',
  alias: [],
  description: 'Configure indexing rules',
  hidden: false,
  dashed: false,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(toolbox.command?.description)
    print.printCommands(toolbox, ['rules'])
    process.exitCode = -1
  },
}
