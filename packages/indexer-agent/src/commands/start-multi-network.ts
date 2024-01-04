import * as fs from 'fs'
import * as path from 'path'
import { specification as spec } from '@graphprotocol/indexer-common'
import * as YAML from 'yaml'
import { Argv } from 'yargs'
import { injectCommonStartupOptions } from './common-options'
import { displayZodParsingError } from './error-handling'
import { Logger } from '@graphprotocol/common-ts'

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

export function parseNetworkSpecifications(
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  argv: any,
  logger: Logger,
): spec.NetworkSpecification[] {
  const dir: string = argv.dir || argv['network-specifications-directory']
  const yamlFiles = scanDirectoryForYamlFiles(dir, logger)
  return parseYamlFiles(yamlFiles)
}

function scanDirectoryForYamlFiles(
  directoryPath: string,
  logger: Logger,
): string[] {
  const yamlFiles: string[] = []

  // Check if the directory exists
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`Directory does not exist: ${directoryPath}`)
  }

  // Check if the provided path is a directory
  const isDirectory = fs.lstatSync(directoryPath).isDirectory()
  if (!isDirectory) {
    throw new Error(`Provided path is not a directory: ${directoryPath}`)
  }

  // Read the directory
  const files = fs.readdirSync(directoryPath)
  logger.trace(
    `Network configuration directory contains ${files.length} file(s)`,
    { directoryPath, files },
  )

  // Iterate over each file in the directory
  for (const file of files) {
    const filePath = path.join(directoryPath, file)

    // Check if the file is a regular file and has a YAML extension
    const isFile = fs.lstatSync(filePath).isFile()
    const isYaml = /\.ya?ml$/i.test(file)
    logger.trace(`Network specification candidate file found: '${file}'`, {
      isFile,
      isYaml,
    })
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
      `No YAML file was found in '${directoryPath}'. At least one file is required.`,
    )
  }

  return yamlFiles
}

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
function readYamlFile(filePath: string): any {
  const text = fs.readFileSync(filePath, 'utf8')
  let content
  try {
    content = YAML.parse(text)
  } catch (yamlParseError) {
    throw new Error(
      `Failed to parse network specification YAML file at ${filePath}.\n${yamlParseError}`,
    )
  }
  if (!content) {
    throw new Error(
      `Failed to parse network specification YAML file: ${filePath}.\nFile is empty.`,
    )
  }
  return content
}

function parseYamlFile(filePath: string): spec.NetworkSpecification {
  let yamlContent
  try {
    yamlContent = readYamlFile(filePath)
  } catch (error) {
    console.log(error.message)
    process.exit(1)
  }

  try {
    return spec.NetworkSpecification.parse(yamlContent)
  } catch (error) {
    displayZodParsingError(error, filePath)
    process.exit(1)
  }
}

function parseYamlFiles(filePaths: string[]): spec.NetworkSpecification[] {
  return filePaths.map(parseYamlFile)
}
