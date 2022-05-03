import fs from 'fs'
import path from 'path'
import envPaths from 'env-paths'
import toml, { JsonMap } from '@iarna/toml'
import { print } from 'gluegun'

export interface UnvalidatedIndexingConfig {
  api?: string
}

export interface IndexingConfig {
  api: string
}

const DEFAULT_CONFIG = {}

const CONFIG_FILE = path.join(
  envPaths('graph-cli', { suffix: '' }).config,
  'indexing.toml',
)

export const loadConfig = (): UnvalidatedIndexingConfig => {
  if (fs.existsSync(CONFIG_FILE)) {
    return toml.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } else {
    return DEFAULT_CONFIG
  }
}

export const loadValidatedConfig = (): IndexingConfig => {
  const config = loadConfig()
  const errors = []
  if (!config.api) {
    errors.push(`- 'api' is not set. Please run 'graph indexer connect <url>' first`)
  }

  if (errors.length > 0) {
    print.error(`Failed to load indexer CLI configuration:`)
    print.error(errors.join('\n'))
    process.exit(1)
  }

  return config as IndexingConfig
}

export const writeConfig = (config: UnvalidatedIndexingConfig): void => {
  if (!fs.existsSync(path.dirname(CONFIG_FILE))) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  }
  fs.writeFileSync(CONFIG_FILE, toml.stringify(config as JsonMap), { encoding: 'utf-8' })
}
