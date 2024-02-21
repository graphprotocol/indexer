import { Logger, WritableEventual } from '@graphprotocol/common-ts'
import { IndexerManagementModels } from './models'
import { GraphNode } from '../graph-node'
import { ActionManager, MultiNetworks, Network } from '@graphprotocol/indexer-common'
import { IndexerManagementDefaults } from './client'

export interface IndexerManagementResolverContext {
  models: IndexerManagementModels
  graphNode: GraphNode
  logger: Logger
  defaults: IndexerManagementDefaults
  actionManager: ActionManager | undefined
  multiNetworks: MultiNetworks<Network> | undefined
  dai: WritableEventual<string>
}
