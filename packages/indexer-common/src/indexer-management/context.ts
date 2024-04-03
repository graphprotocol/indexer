import { Logger, WritableEventual } from '@graphprotocol/common-ts'
import { IndexerManagementModels, IndexingRuleCreationAttributes } from './models'
import { GraphNode } from '../graph-node'
import { BigNumber } from 'ethers'
import { ActionManager } from './actions'
import { MultiNetworks } from '../multi-networks'
import { Network } from '../network'

export interface IndexerManagementDefaults {
  globalIndexingRule: Omit<
    IndexingRuleCreationAttributes,
    'identifier' | 'allocationAmount'
  > & { allocationAmount: BigNumber }
}

export interface IndexerManagementResolverContext {
  models: IndexerManagementModels
  graphNode: GraphNode
  logger: Logger
  defaults: IndexerManagementDefaults
  actionManager: ActionManager | undefined
  multiNetworks: MultiNetworks<Network> | undefined
  dai: WritableEventual<string>
}
