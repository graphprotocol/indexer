import { connectDatabase, createLogger } from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  SubgraphIdentifierType,
  fetchIndexingRules,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'
import { Sequelize } from 'sequelize'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

let sequelize: Sequelize
let models: IndexerManagementModels

const setupModels = async () => {
  // Spin up db
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  await sequelize.sync({ force: true })
}
describe('Indexing Rules', () => {
  beforeAll(setupModels)
  test('Insert and fetch indexing rule', async () => {
    const logger = createLogger({
      name: 'POI dispute tests',
      async: false,
      level: __LOG_LEVEL__ ?? 'error',
    })
    const deployment = 'QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF'
    const indexingRule = {
      identifier: deployment,
      allocationAmount: '5000',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.ALWAYS,
    } as Partial<IndexingRuleAttributes>

    const setIndexingRuleResult = await upsertIndexingRule(logger, models, indexingRule)
    expect(setIndexingRuleResult).toHaveProperty(
      'allocationAmount',
      '5000000000000000000000',
    )
    expect(setIndexingRuleResult).toHaveProperty('identifier', deployment)
    expect(setIndexingRuleResult).toHaveProperty(
      'identifierType',
      SubgraphIdentifierType.DEPLOYMENT.toString(),
    )
    expect(setIndexingRuleResult).toHaveProperty(
      'decisionBasis',
      IndexingDecisionBasis.ALWAYS,
    )

    await expect(fetchIndexingRules(models, false)).resolves.toHaveLength(1)
  })
})
