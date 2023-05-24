import * as fs from 'fs'
import * as path from 'path'
import { specification as spec } from '@graphprotocol/indexer-common'
import * as YAML from 'yaml'
import { Argv } from 'yargs'
import { injectCommonStartupOptions } from './common-options'

export const startMultiNetwork = {
  command: 'start-multiple',
  describe: 'Start the Agent in multiple Protocol Networks',
  builder: (args: Argv): Argv => {
    const updatedArgs = injectCommonStartupOptions(args)
    return updatedArgs.option('network-specifications-directory', {
      alias: 'dir',
      description: 'Path to a directory containing network specificaiton files',
      type: 'string',
      required: true,
    })
  },
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: (_argv: any) => {},
}

export function parseNetworkSpecifications(
  argv: any,
): spec.NetworkSpecification[] {
  const dir: string = argv.dir
  const yamlFiles = scanDirectoryForYamlFiles(dir)
  return parseYamlFiles(yamlFiles)
}

function scanDirectoryForYamlFiles(directoryPath: string): string[] {
  const yamlFiles: string[] = []

  // Check if the directory exists
  if (!fs.existsSync(directoryPath)) {
    throw new Error('Directory does not exist.')
  }

  // Check if the provided path is a directory
  const isDirectory = fs.lstatSync(directoryPath).isDirectory()
  if (!isDirectory) {
    throw new Error('Provided path is not a directory.')
  }

  // Read the directory
  const files = fs.readdirSync(directoryPath)

  // Iterate over each file in the directory
  for (const file of files) {
    const filePath = path.join(directoryPath, file)

    // Check if the file is a regular file and has a YAML extension
    const isFile = fs.lstatSync(filePath).isFile()
    const isYaml = file.endsWith('.yaml') || file.endsWith('.yml')
    if (isFile && isYaml) {
      try {
        // Check if the file can be read
        fs.accessSync(filePath, fs.constants.R_OK)
        yamlFiles.push(filePath)
      } catch (error) {
        throw new Error(`Cannot read file: ${filePath}`)
      }
    }
  }

  // Check if at least one YAMl file was found
  if (yamlFiles.length === 0) {
    throw new Error(
      'No YAML file was found in `{directoryPath}`. At least one file is required.',
    )
  }

  return yamlFiles
}

function readYamlFile(filePath: string): string {
  const text = fs.readFileSync(filePath, 'utf8')
  return YAML.parse(text)
}

function parseYamlFiles(filePaths: string[]): spec.NetworkSpecification[] {
  return filePaths
    .map(readYamlFile)
    .map(x => spec.NetworkSpecification.parse(x))
}
