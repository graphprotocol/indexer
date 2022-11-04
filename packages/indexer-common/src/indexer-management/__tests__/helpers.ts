import { connectDatabase, createLogger } from '@graphprotocol/common-ts'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
} from '../models'
import { fetchIndexingRules, upsertIndexingRule } from '../rules'
import { SubgraphIdentifierType } from '../../subgraphs'
import { ActionManager } from '../actions'
import { actionFilterToWhereOptions, ActionStatus, ActionType } from '../../actions'
import { literal, Op, Sequelize } from 'sequelize'

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
      name: 'Indexing rule helpers tests',
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

describe('Actions', () => {
  beforeAll(setupModels)

  test('Generate where options', async () => {
    const ActionFilter = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
    }
    expect(actionFilterToWhereOptions(ActionFilter)).toEqual({
      [Op.and]: [{ status: 'failed' }, { type: 'allocate' }],
    })

    const yesterday = literal("NOW() - INTERVAL '1d'")
    const ActionFilter2 = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
      updatedAt: { [Op.gte]: yesterday },
    }

    const where = actionFilterToWhereOptions(ActionFilter2)
    expect(where).toEqual({
      [Op.and]: [
        { status: 'failed' },
        { type: 'allocate' },
        { updatedAt: { [Op.gte]: yesterday } },
      ],
    })

    await expect(
      models.Action.findAll({
        where,
      }),
    ).resolves.toHaveLength(0)
  })

  test('Insert and fetch actions', async () => {
    const action = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
      deploymentID: 'QmQ44hgrWWt3Qf2X9XEX2fPyTbmQbChxwNm5c1t4mhKpGt',
      amount: '10000',
      force: false,
      source: 'indexerAgent',
      reason: 'indexingRule',
      priority: 0,
    }

    await models.Action.upsert(action)

    const filterOptions = {
      status: ActionStatus.FAILED,
      type: ActionType.ALLOCATE,
    }

    const whereOptions = actionFilterToWhereOptions(filterOptions)
    expect(whereOptions).toEqual({
      [Op.and]: [{ status: 'failed' }, { type: 'allocate' }],
    })

    await expect(ActionManager.fetchActions(models, filterOptions)).resolves.toHaveLength(
      1,
    )

    await expect(ActionManager.fetchActions(models, filterOptions)).resolves.toHaveLength(
      1,
    )

    await expect(
      ActionManager.fetchActions(models, {
        status: ActionStatus.FAILED,
        type: ActionType.ALLOCATE,
        updatedAt: { [Op.gte]: literal("NOW() - INTERVAL '1d'") },
      }),
    ).resolves.toHaveLength(1)

    await expect(
      ActionManager.fetchActions(models, {
        status: ActionStatus.FAILED,
        type: ActionType.ALLOCATE,
        updatedAt: { [Op.lte]: literal("NOW() - INTERVAL '1d'") },
      }),
    ).resolves.toHaveLength(0)
  })
})
