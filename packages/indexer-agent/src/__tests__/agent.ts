import { convertSubgraphBasedRulesToDeploymentBased } from '../agent'
import {
  INDEXING_RULE_GLOBAL,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  SubgraphIdentifierType,
  SubgraphVersion,
} from '@graphprotocol/indexer-common'
import { SubgraphDeploymentID } from '@tokene-q/common-ts'

describe('Agent convenience function tests', () => {
  test('Convert subgraph based rules to deployment based - success', async () => {
    const inputRules = [
      {
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: SubgraphIdentifierType.GROUP,
        allocationAmount: '2300',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
      {
        identifier: '0x0000000000000000000000000000000000000000-0',
        identifierType: SubgraphIdentifierType.SUBGRAPH,
        allocationAmount: '3000',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        allocationAmount: '12000',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
    ] as IndexingRuleAttributes[]

    const subgraphs = [
      {
        id: '0x0000000000000000000000000000000000000000-0',
        versionCount: 1,
        versions: [
          {
            version: 0,
            createdAt: 1,
            deployment: new SubgraphDeploymentID(
              'QmbvTyvmxqHLahZwS7fZtVWGM85VCpCiKHiagPxQJp5ktS',
            ),
          } as SubgraphVersion,
        ],
      },
    ]
    const expectedRules = [
      {
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: SubgraphIdentifierType.GROUP,
        allocationAmount: '2300',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
      {
        identifier:
          '0xc9d18c59e4aaf2c1f86dfef16fbdc0f81eae8ada58d87a23d2666c45704b8823',
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        allocationAmount: '3000',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        allocationAmount: '12000',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
    ] as IndexingRuleAttributes[]

    expect(
      convertSubgraphBasedRulesToDeploymentBased(inputRules, subgraphs, 1000),
    ).toEqual(expectedRules)
  })

  test('Convert subgraph based rules to deployment based - no op', async () => {
    const inputRules = [
      {
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: SubgraphIdentifierType.GROUP,
        allocationAmount: '2300',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        allocationAmount: '12000',
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: IndexingDecisionBasis.RULES,
      },
    ] as IndexingRuleAttributes[]

    const subgraphs = [
      {
        id: '0x0000000000000000000000000000000000000000-0',
        versionCount: 1,
        versions: [
          {
            version: 0,
            createdAt: 1,
            deployment: new SubgraphDeploymentID(
              'QmbvTyvmxqHLahZwS7fZtVWGM85VCpCiKHiagPxQJp5ktS',
            ),
          } as SubgraphVersion,
        ],
      },
    ]

    expect(
      convertSubgraphBasedRulesToDeploymentBased(inputRules, subgraphs, 1000),
    ).toEqual(inputRules)
  })
})
