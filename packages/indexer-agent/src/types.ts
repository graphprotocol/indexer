import { logging } from '@graphprotocol/common-ts'

export interface AgentConfig {
  mnemonic: string
  statusEndpoint: string
  adminEndpoint: string
  logger: logging.Logger
}

export interface SubgraphKey {
  name: string
  subgraphId: string
}
