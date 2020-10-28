import { Sequelize } from 'sequelize/types'
import gql from 'graphql-tag'
import { ethers } from 'ethers'
import {
  connectDatabase,
  connectContracts,
  createLogger,
  Logger,
  NetworkContracts,
  parseGRT,
} from '@graphprotocol/common-ts'

import {
  createIndexerManagementClient,
  IndexerManagementDefaults,
  IndexerManagementFeatures,
} from '../client'
import {
  defineIndexerManagementModels,
  IndexerManagementModels,
  IndexingDecisionBasis,
  INDEXING_RULE_GLOBAL,
} from '../models'

// Make global Jest variable available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any

const SET_INDEXING_RULE_MUTATION = gql`
  mutation setIndexingRule($rule: IndexingRuleInput!) {
    setIndexingRule(rule: $rule) {
      id
      deployment
      allocationAmount
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
    }
  }
`

const DELETE_INDEXING_RULE_MUTATION = gql`
  mutation deleteIndexingRule($deployment: String!) {
    deleteIndexingRule(deployment: $deployment)
  }
`

const DELETE_INDEXING_RULES_MUTATION = gql`
  mutation deleteIndexingRules($deployments: [String!]!) {
    deleteIndexingRules(deployments: $deployments)
  }
`

const INDEXING_RULE_QUERY = gql`
  query indexingRule($deployment: String!, $merged: Boolean!) {
    indexingRule(deployment: $deployment, merged: $merged) {
      id
      deployment
      allocationAmount
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
    }
  }
`

const INDEXING_RULES_QUERY = gql`
  query indexingRuls($merged: Boolean!) {
    indexingRules(merged: $merged) {
      id
      deployment
      allocationAmount
      parallelAllocations
      maxAllocationPercentage
      minSignal
      maxSignal
      minStake
      minAverageQueryFees
      custom
      decisionBasis
    }
  }
`

let sequelize: Sequelize
let models: IndexerManagementModels
let address: string
let contracts: NetworkContracts
let logger: Logger

const defaults: IndexerManagementDefaults = {
  globalIndexingRule: {
    allocationAmount: parseGRT('100'),
    parallelAllocations: 2,
  },
}

const features: IndexerManagementFeatures = {
  injectDai: false,
}

describe('Indexing rules', () => {
  beforeEach(async () => {
    // Spin up db
    sequelize = await connectDatabase(__DATABASE__)
    models = defineIndexerManagementModels(sequelize)
    address = '0xtest'
    contracts = await connectContracts(ethers.getDefaultProvider('rinkeby'), 4)
    await sequelize.sync({ force: true })
    logger = createLogger({ name: 'Indexer API Client', level: 'trace' })
  })

  afterEach(async () => {
    await sequelize.drop({})
  })

  test('Set and get global rule (partial)', async () => {
    const input = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1000',
    }

    const expected = {
      ...input,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      minSignal: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    // Update the rule and ensure the right data is returned
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    await expect(
      client
        .query(INDEXING_RULE_QUERY, { deployment: INDEXING_RULE_GLOBAL, merged: false })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get global rule (complete)', async () => {
    const input = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      parallelAllocations: 5,
      maxAllocationPercentage: 0.5,
      minSignal: '2',
      maxSignal: '3',
      minStake: '4',
      minAverageQueryFees: '5',
      custom: JSON.stringify({ foo: 'bar' }),
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const expected = {
      ...input,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    await expect(
      client
        .query(INDEXING_RULE_QUERY, { deployment: INDEXING_RULE_GLOBAL, merged: false })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get global rule (partial update)', async () => {
    const originalInput = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      minSignal: '2',
    }

    const original = {
      ...originalInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      logger,
      defaults,
      features,
    })

    // Write the orginal
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: originalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', original)

    const update = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: null,
      maxSignal: '3',
    }

    const expected = {
      ...original,
      ...update,
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    await expect(
      client
        .query(INDEXING_RULE_QUERY, { deployment: INDEXING_RULE_GLOBAL, merged: false })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get deployment rule (partial update)', async () => {
    const originalInput = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
      minSignal: '2',
    }

    const original = {
      ...originalInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    // Write the orginal
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: originalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', original)

    const update = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: null,
      maxSignal: '3',
    }

    const expected = {
      ...original,
      ...update,
    }

    // Update the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: update }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query the rule to make sure it's updated in the db
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          deployment:
            '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', expected)
  })

  test('Set and get global and deployment rule', async () => {
    const globalInput = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
    }

    const deploymentInput = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
      minSignal: '2',
    }

    const globalExpected = {
      ...globalInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
    }

    const deploymentExpected = {
      ...deploymentInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    // Write the orginals
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', globalExpected)
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', deploymentExpected)

    // Query the global rule
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          deployment: INDEXING_RULE_GLOBAL,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', globalExpected)

    // Query the rule for the deployment
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          deployment:
            '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentExpected)

    // Query all rules together
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [globalExpected, deploymentExpected])
  })

  test('Set, delete and get rule', async () => {
    const input = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
      minSignal: '2',
    }

    const expected = {
      ...input,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expected)

    // Query all rules
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [expected])

    // Delete the rule
    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, { deployment: expected.deployment })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    // Query all rules together
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [])
  })

  test('Clear a parameter', async () => {
    const input = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
    }

    const expectedBefore = {
      ...input,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      minSignal: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    // Write the rule
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: input }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', expectedBefore)

    // Query all rules
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
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
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      { ...expectedBefore, allocationAmount: null },
    ])
  })

  test('Set and get global and deployment rule (merged)', async () => {
    const globalInput = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
    }

    const deploymentInput = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
      minSignal: '2',
    }

    const globalExpected = {
      ...globalInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.NEVER,
    }

    const deploymentExpected = {
      ...deploymentInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: null,
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const deploymentMergedExpected = {
      ...deploymentInput,
      parallelAllocations: null,
      maxAllocationPercentage: null,
      maxSignal: null,
      minStake: null,
      minAverageQueryFees: '1',
      custom: null,
      decisionBasis: IndexingDecisionBasis.RULES,
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    // Write the orginals
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', globalExpected)
    await expect(
      client.mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput }).toPromise(),
    ).resolves.toHaveProperty('data.setIndexingRule', deploymentExpected)

    // Query the global rule
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          deployment: INDEXING_RULE_GLOBAL,
          merged: false,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', globalExpected)

    // Query the rule for the deployment merged with the global rule
    await expect(
      client
        .query(INDEXING_RULE_QUERY, {
          deployment:
            '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
          merged: true,
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.indexingRule', deploymentMergedExpected)

    // Query all rules together (without merging)
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [globalExpected, deploymentExpected])

    // Query all rules together (with merging)
    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: true }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      globalExpected,
      deploymentMergedExpected,
    ])
  })

  test('Delete global rules (which should reset)', async () => {
    const globalInput = {
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()

    await expect(
      client
        .mutation(DELETE_INDEXING_RULE_MUTATION, {
          deployment: 'global',
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRule', true)

    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      {
        ...defaults.globalIndexingRule,
        allocationAmount: defaults.globalIndexingRule.allocationAmount.toString(),
        custom: null,
        decisionBasis: 'rules',
        deployment: 'global',
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
      deployment: INDEXING_RULE_GLOBAL,
      allocationAmount: '1',
      minSignal: '1',
      decisionBasis: IndexingDecisionBasis.NEVER,
      minAverageQueryFees: '1',
    }

    const deploymentInput = {
      deployment: '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
      allocationAmount: '1',
      minSignal: '2',
    }

    const client = await createIndexerManagementClient({
      models,
      address,
      contracts,
      defaults,
      features,
    })

    await client.mutation(SET_INDEXING_RULE_MUTATION, { rule: globalInput }).toPromise()
    await client
      .mutation(SET_INDEXING_RULE_MUTATION, { rule: deploymentInput })
      .toPromise()

    await expect(
      client
        .mutation(DELETE_INDEXING_RULES_MUTATION, {
          deployments: [
            'global',
            '0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3',
          ],
        })
        .toPromise(),
    ).resolves.toHaveProperty('data.deleteIndexingRules', true)

    await expect(
      client.query(INDEXING_RULES_QUERY, { merged: false }).toPromise(),
    ).resolves.toHaveProperty('data.indexingRules', [
      {
        ...defaults.globalIndexingRule,
        allocationAmount: defaults.globalIndexingRule.allocationAmount.toString(),
        custom: null,
        decisionBasis: 'rules',
        deployment: 'global',
        maxAllocationPercentage: null,
        maxSignal: null,
        minAverageQueryFees: null,
        minSignal: null,
        minStake: null,
      },
    ])
  })
})
