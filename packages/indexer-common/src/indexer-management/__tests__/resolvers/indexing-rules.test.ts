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
      protocolNetwork
    }
  }
`

const DELETE_INDEXING_RULE_MUTATION = gql`
  mutation deleteIndexingRule($identifier: IndexingRuleIdentifier!) {
    deleteIndexingRule(identifier: $identifier)
  }
`

const DELETE_INDEXING_RULES_MUTATION = gql`
  mutation deleteIndexingRules($identifiers: [IndexingRuleIdentifier!]!) {
    deleteIndexingRules(identifiers: $identifiers)
  }
`

const INDEXING_RULE_QUERY = gql`
  query indexingRule($identifier: IndexingRuleIdentifier!, $merged: Boolean!) {
    indexingRule(identifier: $identifier, merged: $merged) {
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
      protocolNetwork
    }
  }
`

const INDEXING_RULES_QUERY = gql`
  query indexingRules($merged: Boolean!, $protocolNetwork: String!) {
    indexingRules(merged: $merged, protocolNetwork: $protocolNetwork) {
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
      protocolNetwork
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
    }

    // Update the rule and ensure the right data is returned
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: 'arbitrum-sepolia',
    }

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
      protocolNetwork: 'arbitrum-sepolia',
    }

    const expected = {
      ...input,
      protocolNetwork: 'eip155:421614',
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: 'arbitrum-sepolia',
    }
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'arbitrum-sepolia',
    }

    const expected = {
      ...original,
      ...update,
      protocolNetwork: 'eip155:421614',
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, { identifier: ruleIdentifier, merged: false })
        .toPromise(),
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'arbitrum-sepolia',
    }

    const expected = {
      ...original,
      ...update,
      protocolNetwork: 'eip155:421614',
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifier = {
      identifier: update.identifier,
      protocolNetwork: update.protocolNetwork,
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: ruleIdentifier,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)

    const updateAgain = {
      identifier: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationLifetime: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
      autoRenewal: true,
      protocolNetwork: 'arbitrum-sepolia',
    }

    const expectedAgain = {
      ...original,
      ...update,
      ...updateAgain,
      protocolNetwork: 'eip155:421614',
    }
    expectedAgain.identifier = originalIdentifier

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: updateAgain }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expectedAgain)

    // Query the rule to make sure it's updated in the db
    const ruleIdentifierAgain = {
      identifier: originalIdentifier,
      protocolNetwork: updateAgain.protocolNetwork,
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'arbitrum-sepolia',
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
    const deploymentRuleIdentifier = {
      identifier: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: deploymentRuleIdentifier,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentExpected)

    // Query all rules together
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
    }

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query all rules
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [expected])

    // Delete the rule
    const ruleIdentifier = {
      identifier: expected.identifier,
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, {
          identifier: ruleIdentifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    // Query all rules together
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [])
  })

  test('Clear a parameter', async () => {
    const input = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      requireSupported: true,
      safety: true,
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
    }

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expectedBefore)

    // Query all rules
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'arbitrum-sepolia',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'eip155:421614',
    }

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
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: globalRuleIdentifier,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', globalExpected)

    // Query the rule for the deployment merged with the global rule
    const ruleIdentifier = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          identifier: ruleIdentifier,
          merged: true,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentMergedExpected)

    // Query all rules together (without merging)
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [globalExpected, deploymentExpected])

    // Query all rules together (with merging)
    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: true,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
      protocolNetwork: 'arbitrum-sepolia',
    }

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()

    const globalRuleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: 'arbitrum-sepolia',
    }
    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, {
          identifier: globalRuleIdentifier,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
        protocolNetwork: 'eip155:421614',
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
      protocolNetwork: 'arbitrum-sepolia',
    }

    const deploymentInput = {
      identifier: 'QmZSJPm74tvhgr8uzhqvyQm2J6YSbUEj4nF6j8WxxUQLsC',
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1',
      minSignal: '2',
      requireSupported: true,
      safety: true,
      protocolNetwork: 'arbitrum-sepolia',
    }

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()
    await client
      .mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput })
      .toPromise()

    const globalRuleIdentifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: 'arbitrum-sepolia',
    }
    const deploymentRuleIdentifier = {
      identifier: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      protocolNetwork: 'arbitrum-sepolia',
    }

    await expect(
      client
        .mutation(DELETE_INDEXING_RULES_MUTATION, {
          identifiers: [globalRuleIdentifier, deploymentRuleIdentifier],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRules', true)

    await expect(
      client
        .query(INDEXING_RULES_QUERY, {
          merged: false,
          protocolNetwork: 'arbitrum-sepolia',
        })
        .toPromise(),
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
        protocolNetwork: 'eip155:421614',
      },
    ])
  })
})
