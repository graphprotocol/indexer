import * as fs from 'fs'
import * as YAML from 'yaml'
import { NetworkSpecification } from '../network-specification'
import { Logger } from '@graphprotocol/common-ts'
import { displayZodParsingError } from './error-handling'
import path from 'path'

export function loadTestYamlConfig() {
  const PUBLIC_JSON_RPC_ENDPOINT = 'https://ethereum-sepolia.publicnode.com'
  const testProviderUrl =
    process.env.INDEXER_TEST_JRPC_PROVIDER_URL ?? PUBLIC_JSON_RPC_ENDPOINT
  const INDEXER_TEST_API_KEY: string = process.env['INDEXER_TEST_API_KEY'] || ''
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function injectApiKey(apiKey: string, keys: string[], yaml: any) {
    keys.forEach((key) => {
      const url: string = yaml['subgraphs'][key]['url']
      yaml['subgraphs'][key]['url'] = url.replace('<api-key>', apiKey)
    })
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function injectProviderUrl(providerUrl: string, yaml: any) {
    yaml['networkProvider']['url'] = providerUrl
  }
  // If the application is being executed using ts-node __dirname may be in /src rather than /dist
  const networkSpecFile = path
    .join(__dirname, '..', '..', '..', '..', 'network-configs', 'config.yaml')
    .toString()

  const yamlObj = readYamlFile(networkSpecFile)
  injectProviderUrl(testProviderUrl, yamlObj)
  injectApiKey(
    INDEXER_TEST_API_KEY,
    ['networkSubgraph', 'epochSubgraph', 'tapSubgraph'],
    yamlObj,
  )

  return yamlObj
}
// eslint-disable-next-line  @typescript-eslint/no-explicit-any
export function readYamlFile(filePath: string): any {
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

function parseYamlFile(filePath: string): NetworkSpecification {
  let yamlContent
  try {
    yamlContent = readYamlFile(filePath)
  } catch (error) {
    console.log(error.message)
    process.exit(1)
  }

  try {
    return NetworkSpecification.parse(yamlContent)
  } catch (error) {
    displayZodParsingError(error, filePath)
    process.exit(1)
  }
}

export function parseNetworkSpecification(
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  argv: any,
  logger: Logger,
): NetworkSpecification | undefined {
  const dir: string = argv.dir || argv['network-specifications-directory']
  const yamlFiles = scanDirectoryForYamlFiles(dir, logger)
  if (yamlFiles.length === 0) {
    logger.info('No network specification files found in the provided directory')
    return undefined
  } else if (yamlFiles.length === 1) {
    logger.info(`Found yaml config at ${dir}/${yamlFiles[0]} (ignoring others})`)
    return parseYamlFile(yamlFiles[0])
  } else {
    throw new Error(`Multiple network specification files found in ${dir}.`)
  }
}

function scanDirectoryForYamlFiles(directoryPath: string, logger: Logger): string[] {
  const yamlFiles: string[] = []

  // Check if the directory exists
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`Directory does not exist: ${directoryPath} `)
  }

  // Check if the provided path is a directory
  const isDirectory = fs.lstatSync(directoryPath).isDirectory()
  if (!isDirectory) {
    throw new Error(`Provided path is not a directory: ${directoryPath} `)
  }

  // Read the directory
  const files = fs.readdirSync(directoryPath)
  logger.trace(`Network configuration directory contains ${files.length} file(s)`, {
    directoryPath,
    files,
  })

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
        throw new Error(`Cannot read file: ${filePath} `)
      }
    }
  }

  // Check if at least one YAMl file was found
  if (yamlFiles.length === 0) {
    throw new Error(
      `No YAML file was found in '${directoryPath}'.At least one file is required.`,
    )
  }

  return yamlFiles
}
