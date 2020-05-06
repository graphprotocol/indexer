import { logging } from '@graphprotocol/common-ts'

export interface AgentConfig {
  queryNode: string
  logger: logging.Logger
}

export interface SubgraphKey {
  name?: string
  contentHash: string
}
