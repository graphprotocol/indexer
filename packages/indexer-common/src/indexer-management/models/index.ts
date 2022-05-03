import { Sequelize } from 'sequelize'

import { IndexingRuleModels, defineIndexingRuleModels } from './indexing-rule'
import { CostModelModels, defineCostModelModels } from './cost-model'
import { POIDisputeModels, definePOIDisputeModels } from './poi-dispute'
import { ActionModels, defineActionModels } from './action'

export * from './cost-model'
export * from './indexing-rule'
export * from './poi-dispute'
export * from './action'

export type IndexerManagementModels = IndexingRuleModels &
  CostModelModels &
  POIDisputeModels &
  ActionModels

export const defineIndexerManagementModels = (
  sequelize: Sequelize,
): IndexerManagementModels =>
  Object.assign(
    {},
    defineCostModelModels(sequelize),
    defineIndexingRuleModels(sequelize),
    definePOIDisputeModels(sequelize),
    defineActionModels(sequelize),
  )
