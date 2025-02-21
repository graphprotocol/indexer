import { Sequelize } from 'sequelize'
import gql from 'graphql-tag'
import {
  connectDatabase,
  createLogger,
  Logger,
  createMetrics,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '../../client'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  IndexingDecisionBasis,
  INDEXING_RULE_GLOBAL,
} from '../../models'
import {
  SubgraphIdentifierType,
  defineQueryFeeModels,
} from '@graphprotocol/indexer-common'

import { createTestManagementClient, defaults } from '../util'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __LOG_LEVEL__: any

const SET_INDEXING_RULE_MUTATION = gql`
  mutation setIndexingRule($rule: IndexingRuleInput!) {
    setIndexingRule(rule: $rule) {
      identifier
      identifierType
      allocationAmount
      allocationLifetime
      autoRenewal
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
      requireSupported
      safety
    }
  }
`

const DELETE_INDEXING_RULE_MUTATION = gql`
  mutation deleteIndexingRule($identifier: String!) {
    deleteIndexingRule(identifier: $identifier)
  }
`

const DELETE_INDEXING_RULES_MUTATION = gql`
  mutation deleteIndexingRules($identifiers: [String!]!) {
    deleteIndexingRules(identifiers: $identifiers)
  }
`

const INDEXING_RULE_QUERY = gql`
  query indexingRule($identifier: String!) {
    indexingRule(identifier: $identifier) {
      identifier
      identifierType
      allocationAmount
      allocationLifetime
      autoRenewal
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
      requireSupported
      safety
    }
  }
`

const INDEXING_RULES_QUERY = gql`
  query indexingRules {
    indexingRules {
      identifier
      identifierType
      allocationAmount
      allocationLifetime
      autoRenewal
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
      requireSupported
      safety
    }
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let logger: Logger
let client: IndexerManagementClient
const metrics = createMetrics()

const setupAll = async () => {
  sequelize = await connectDatabase(__DATABASE__)
  models = defineIndexerManagementModels(sequelize)
  defineQueryFeeModels(sequelize)
  await sequelize.sync({ force: true })

  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  client = await createTestManagementClient(__DATABASE__, logger, metrics)
}

const teardownAll = async () => {
  await sequelize.drop({})
}

const setupEach = async () => {
  await sequelize.sync({ force: true })
}
const teardownEach = async () => {
  // Clear out indexer management models
  await models.Action.truncate({ cascade: true })
  await models.CostModel.truncate({ cascade: true })
  await models.IndexingRule.truncate({ cascade: true })
  await models.POIDispute.truncate({ cascade: true })
}

describe('Indexing rules', () => {
  jest.setTimeout(60_000)
  beforeAll(setupAll)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  test('Set and get global rule (partial)', async () => {
    const input = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1000',
    }

    const expected = {
      ...input,
      allocationLifetime: null,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      minSignal: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
    }

    // Update the rule and ensure the right data is returned
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = INDEXING_RULE_GLOBAL

    const result = await client
      .query(INDEXING_RULE_QUERY, { identifier: ruleIdentifier, merged: false })
      .toPromise()
    expect(result).toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get global rule (complete)', async () => {
    const input = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      allocationLifetime: 10,
      autoRenewal: true,
      parallelAllocations: 1,
      maxAllocationPercentage: 0.5,
      minSignal: '2',
      maxSignal: '3',
      minStake: '4',
      minAverageQueryFees: '5',
      custom: JSON.stringify({ foo: 'bar' }),
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
    }

    const expected = {
      ...input,
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = INDEXING_RULE_GLOBAL
    await expect(
      client
        .query(INDEXING_RULE_QUERY, { identifier: ruleIdentifier, merged: false })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get global rule (partial update)', async () => {
    const originalInput = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      minSignal: '2',
    }

    const original = {
      ...originalInput,
      allocationLifetime: null,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
    }

    // Write the original
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: originalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', original)

    const update = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: null,
      maxSignal: '3',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      autoRenewal: true,
      safety: false,
    }

    const expected = {
      ...original,
      ...update,
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    await expect(
      client.query(INDEXING_RULE_QUERY, { identifier: INDEXING_RULE_GLOBAL }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get deployment rule (partial update)', async () => {
    const originalIdentifier = 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC'
    const originalInput = {
      identifier: originalIdentifier,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
    }

    const original = {
      ...originalInput,
      allocationLifetime: null,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: true,
      safety: true,
    }

    // Write the original
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: originalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', original)

    const update = {
      identifier: originalIdentifier,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: null,
      maxSignal: '3',
      decisionBasis: IndexingDecisionBasis.ALWAYS,
      allocationLifetime: 2,
      autoRenewal: false,
      requireSupported: false,
      safety: false,
    }

    const expected = {
      ...original,
      ...update,
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: update.identifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)

    const updateAgain = {
      identifier: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationLifetime: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
      autoRenewal: true,
    }

    const expectedAgain = {
      ...original,
      ...update,
      ...updateAgain,
    }
    expectedAgain.identifier = originalIdentifier

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: updateAgain }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expectedAgain)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifierAgain = {
      identifier: originalIdentifier,
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: ruleIdentifierAgain,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expectedAgain)
  })

  test('Set and get global and deployment rule', async () => {
    const globalInput = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
    }

    const deploymentInput = {
      identifier: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: false,
      autoRenewal: false,
      safety: true,
    }

    const globalExpected = {
      ...globalInput,
      allocationLifetime: null,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
      requireSupported: true,
      safety: true,
    }

    const deploymentExpected = {
      ...deploymentInput,
      allocationLifetime: null,
      autoRenewal: false,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: false,
      safety: true,
    }
    deploymentExpected.identifier = 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC'

    // Write the orginals
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', globalExpected)
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', deploymentExpected)

    // Query the global rule
    const globalRuleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: globalRuleIdentifier,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', globalExpected)

    // Query the rule for the deployment
    const deploymentRuleIdentifier =
      '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3'
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: deploymentRuleIdentifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentExpected)

    // Query all rules together
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [globalExpected, deploymentExpected])
  })

  test('Set, delete and get rule', async () => {
    const input = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      allocationLifetime: 20,
      autoRenewal: false,
    }

    const expected = {
      ...input,
      allocationLifetime: 20,
      autoRenewal: false,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
      requireSupported: true,
      safety: true,
    }

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query all rules
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [expected])

    // Delete the rule
    const ruleIdentifier = expected.identifier
    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, {
          identifier: ruleIdentifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    // Query all rules together
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [])
  })

  test('Clear a parameter', async () => {
    const input = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      requireSupported: true,
      safety: true,
    }

    const expectedBefore = {
      ...input,
      allocationLifetime: null,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      minSignal: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expectedBefore)

    // Query all rules
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [expectedBefore])

    // Clear the allocationAmount field
    await expect(
      client
        .mutation(SET_INDEXING_RULE_MUTATION, {
          rule: { ...expectedBefore, allocationAmount: null },
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', {
      ...expectedBefore,
      allocationAmount: null,
    })

    // Query the rules again to see that the update went through
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      { ...expectedBefore, allocationAmount: null },
    ])
  })

  test('Set and get global and deployment rule (merged)', async () => {
    const globalInput = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
      allocationLifetime: 15,
      requireSupported: true,
      autoRenewal: true,
      safety: false,
    }

    const deploymentInput = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      allocationLifetime: 10,
      autoRenewal: false,
      requireSupported: false,
      safety: true,
    }

    const globalExpected = {
      ...globalInput,
      allocationLifetime: 15,
      autoRenewal: true,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
      requireSupported: true,
      safety: false,
    }

    const deploymentExpected = {
      ...deploymentInput,
      allocationLifetime: 10,
      autoRenewal: false,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: false,
      safety: true,
    }

    const deploymentMergedExpected = {
      ...deploymentInput,
      allocationLifetime: 10,
      autoRenewal: false,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: '1',
      custom: null,
      decisionBasis: IndexingDecisionBasis.OFFCHAIN,
      requireSupported: false,
      safety: true,
    }

    // Write the orginals
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', globalExpected)
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', deploymentExpected)

    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: INDEXING_RULE_GLOBAL,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', globalExpected)

    // Query the rule for the deployment merged with the global rule
    const identifier = 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC'

    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier,
          merged: true,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentMergedExpected)

    // Query all rules together (without merging)
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [globalExpected, deploymentExpected])

    // Query all rules together (with merging)
    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      globalExpected,
      deploymentMergedExpected,
    ])
  })

  test('Delete global rules (which should reset)', async () => {
    const globalInput = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
    }

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()

    const identifier = INDEXING_RULE_GLOBAL
    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, {
          identifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      {
        ...defaults.globalIndexingRule,
        allocationAmount: defaults.globalIndexingRule.allocationAmount.toString(),
        custom: null,
        decisionBasis: 'rules',
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: SubgraphIdentifierType.GROUP,
        allocationLifetime: null,
        autoRenewal: true,
        maxAllocationPercentage: null,
        maxSignal: null,
        minAverageQueryFees: null,
        minSignal: null,
        minStake: null,
      },
    ])
  })

  test('Delete multiple rules, including global (which should reset)', async () => {
    const globalInput = {
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
      requireSupported: false,
      safety: false,
    }

    const deploymentInput = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      requireSupported: true,
      safety: true,
    }

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()
    await client
      .mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput })
      .toPromise()

    const globalRuleIdentifier = INDEXING_RULE_GLOBAL
    const deploymentRuleIdentifier =
      '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3'

    await expect(
      client
        .mutation(DELETE_INDEXING_RULES_MUTATION, {
          identifiers: [globalRuleIdentifier, deploymentRuleIdentifier],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRules', true)

    await expect(
      client.query(INDEXING_RULES_QUERY, {}).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      {
        ...defaults.globalIndexingRule,
        allocationAmount: defaults.globalIndexingRule.allocationAmount.toString(),
        custom: null,
        decisionBasis: 'rules',
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: SubgraphIdentifierType.GROUP,
        allocationLifetime: null,
        autoRenewal: true,
        maxAllocationPercentage: null,
        maxSignal: null,
        minAverageQueryFees: null,
        minSignal: null,
        minStake: null,
        requireSupported: true,
        safety: true,
      },
    ])
  })
})
