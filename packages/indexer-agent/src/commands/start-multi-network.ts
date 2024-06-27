import { Argv } from 'yargs'
import { injectCommonStartupOptions } from './common-options'

export const startMultiNetwork = {
  command: 'start',
  describe: 'Start the Agent in multiple Protocol Networks',
  builder: (args: Argv): Argv => {
    const updatedArgs = injectCommonStartupOptions(args)
    return updatedArgs.option('network-specifications-directory', {
      alias: 'dir',
      description: 'Path to a directory containing network specification files',
      type: 'string',
      required: true,
    })
  },
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  handler: (_argv: any) => {},
}
