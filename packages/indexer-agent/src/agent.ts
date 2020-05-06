import { logging } from '@graphprotocol/common-ts'

import { AgentConfig } from './types'

export class Agent {
  logger: logging.Logger

  constructor(config: AgentConfig) {
    this.logger = config.logger
  }

  async start() {
    this.logger.info("Start Indexer-Agent")
  }
}
