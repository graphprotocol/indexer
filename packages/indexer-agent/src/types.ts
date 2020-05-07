import { logging } from '@graphprotocol/common-ts'

export interface AgentConfig {
  queryNode: string
  indexNode: string
  logger: logging.Logger
}

export interface SubgraphKey {
  name?: string
  contentHash: string
}
