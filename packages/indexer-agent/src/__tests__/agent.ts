import {
  convertSubgraphBasedRulesToDeploymentBased,
  consolidateAllocationDecisions,
} from '../agent'
import {
  GeneratedGraphQLTypes,
  INDEXING_RULE_GLOBAL,
  SubgraphVersion,
} from '@graphprotocol/indexer-common'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

describe('Agent convenience function tests', () => {
  test('Convert subgraph based rules to deployment based - success', async () => {
    const inputRules = [
      {
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: 'group',
        allocationAmount: BigInt(2300),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
        protocolNetwork: 'sepolia',
      },
      {
        identifier: '0x0000000000000000000000000000000000000000-0',
        identifierType: 'subgraph',
        allocationAmount: BigInt(3000),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
        protocolNetwork: 'sepolia',
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: 'deployment',
        allocationAmount: BigInt(12000),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
    ] satisfies GeneratedGraphQLTypes.IndexingRule[]

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
        identifierType: 'group',
        allocationAmount: BigInt(2300),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
      {
        identifier:
          '0xc9d18c59e4aaf2c1f86dfef16fbdc0f81eae8ada58d87a23d2666c45704b8823',
        identifierType: 'deployment',
        allocationAmount: BigInt(3000),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: 'deployment',
        allocationAmount: BigInt(12000),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
    ] satisfies GeneratedGraphQLTypes.IndexingRule[]

    expect(
      convertSubgraphBasedRulesToDeploymentBased(inputRules, subgraphs, 1000),
    ).toEqual(expectedRules)
  })

  test('Convert subgraph based rules to deployment based - no op', async () => {
    const inputRules = [
      {
        identifier: INDEXING_RULE_GLOBAL,
        identifierType: 'group',
        allocationAmount: BigInt(2300),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
      {
        identifier: 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr',
        identifierType: 'deployment',
        allocationAmount: BigInt(12000),
        parallelAllocations: null,
        maxAllocationPercentage: null,
        minSignal: null,
        maxSignal: null,
        minStake: null,
        minAverageQueryFees: null,
        custom: null,
        decisionBasis: 'rules',
        protocolNetwork: 'sepolia',
        autoRenewal: false,
        requireSupported: false,
        safety: false,
      },
    ] satisfies GeneratedGraphQLTypes.IndexingRule[]

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

describe('consolidateAllocationDecisions function', () => {
  it('produces a set with unique deployment ids', () => {
    const a = new SubgraphDeploymentID(
      'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
    )
    const b = new SubgraphDeploymentID(
      'QmRKs2ZfuwvmZA3QAWmCqrGUjV9pxtBUDP3wuc6iVGnjA2',
    )
    const c = new SubgraphDeploymentID(
      'QmULAfA3eS5yojxeSR2KmbyuiwCGYPjymsFcpa6uYsu6CJ',
    )

    const allocationDecisions = {
      'eip155:0': [
        { deployment: a, toAllocate: false },
        { deployment: b, toAllocate: true },
      ],
      'eip155:1': [
        { deployment: b, toAllocate: true },
        { deployment: c, toAllocate: false },
      ],
      'eip155:2': [
        { deployment: c, toAllocate: true },
        { deployment: a, toAllocate: false },
      ],
    }

    const expected = new Set([c, b])

    const result = consolidateAllocationDecisions(allocationDecisions)

    expect(result).toStrictEqual(expected)
    expect(result).toHaveProperty('size', 2)
    expect(result).toContain(c)
    expect(result).toContain(b)
    expect(result).not.toContain(a)
  })
})
