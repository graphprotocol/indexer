import { Sequelize } from 'sequelize'

import { IndexingRuleModels, defineIndexingRuleModels } from './indexing-rule'
import { CostModelModels, defineCostModelModels } from './cost-model'

export * from './indexing-rule'
export * from './cost-model'

export type IndexerManagementModels = IndexingRuleModels & CostModelModels

export const defineIndexerManagementModels = (
  sequelize: Sequelize,
): IndexerManagementModels => ({
  ...defineCostModelModels(sequelize),
  ...defineIndexingRuleModels(sequelize),
})
