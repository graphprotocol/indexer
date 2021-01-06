import { Sequelize } from 'sequelize'

import { IndexingRuleModels, defineIndexingRuleModels } from './indexing-rule'
import { CostModelModels, defineCostModelModels } from './cost-model'
import { POIDisputeModels, definePOIDisputeModels } from './poi-dispute'

export * from './indexing-rule'
export * from './cost-model'
export * from './poi-dispute'

export type IndexerManagementModels = IndexingRuleModels &
  CostModelModels &
  POIDisputeModels

export const defineIndexerManagementModels = (
  sequelize: Sequelize,
): IndexerManagementModels =>
  Object.assign(
    {},
    defineCostModelModels(sequelize),
    defineIndexingRuleModels(sequelize),
    definePOIDisputeModels(sequelize),
  )
