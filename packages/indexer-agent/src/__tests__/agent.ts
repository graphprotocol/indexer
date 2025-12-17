import {
  convertSubgraphBasedRulesToDeploymentBased,
  consolidateAllocationDecisions,
  resolveTargetDeployments,
} from '../agent'
import {
  INDEXING_RULE_GLOBAL,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  SubgraphIdentifierType,
  SubgraphVersion,
} from '@graphprotocol/indexer-common'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

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

describe('resolveTargetDeployments function', () => {
  const alwaysDeployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )
  const offchainDeployment = new SubgraphDeploymentID(
    'QmRKs2ZfuwvmZA3QAWmCqrGUjV9pxtBUDP3wuc6iVGnjA2',
  )
  const allocationDeployment = new SubgraphDeploymentID(
    'QmULAfA3eS5yojxeSR2KmbyuiwCGYPjymsFcpa6uYsu6CJ',
  )
  const offchainArgDeployment = new SubgraphDeploymentID(
    'QmWmyoMoctfbAaiEs2G46gpeUmhqFRDW6KWo64y5r581Vz',
  )

  it('includes OFFCHAIN rules when allocationDecisions is empty (manual mode)', () => {
    const rules = {
      'eip155:42161': [
        {
          identifier: offchainDeployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.OFFCHAIN,
        } as IndexingRuleAttributes,
      ],
    }

    const result = resolveTargetDeployments({}, rules, [])

    expect(result.size).toBe(1)
    expect([...result].map(d => d.ipfsHash)).toContain(
      offchainDeployment.ipfsHash,
    )
  })

  it('includes offchainSubgraphs from startup args', () => {
    const result = resolveTargetDeployments({}, {}, [offchainArgDeployment])

    expect(result.size).toBe(1)
    expect([...result].map(d => d.ipfsHash)).toContain(
      offchainArgDeployment.ipfsHash,
    )
  })

  it('includes deployments from allocationDecisions', () => {
    const allocationDecisions = {
      'eip155:42161': [{ deployment: allocationDeployment, toAllocate: true }],
    }

    const result = resolveTargetDeployments(allocationDecisions, {}, [])

    expect(result.size).toBe(1)
    expect(result).toContain(allocationDeployment)
  })

  /**
   * BUG TEST: In manual allocation mode, networkDeploymentAllocationDecisions is empty
   * because evaluateDeployments is skipped. This means decisionBasis: ALWAYS rules
   * are not included in targetDeployments, causing those subgraphs to be paused.
   *
   * This test should FAIL with the current buggy code and PASS after the fix.
   */
  it('includes ALWAYS rules when allocationDecisions is empty (manual mode)', () => {
    const rules = {
      'eip155:42161': [
        {
          identifier: alwaysDeployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
        } as IndexingRuleAttributes,
      ],
    }

    // In manual mode, allocationDecisions is empty because evaluateDeployments is skipped
    const result = resolveTargetDeployments({}, rules, [])

    // ALWAYS rules should still be included in targetDeployments
    expect(result.size).toBe(1)
    expect([...result].map(d => d.ipfsHash)).toContain(
      alwaysDeployment.ipfsHash,
    )
  })

  it('combines all sources correctly', () => {
    const allocationDecisions = {
      'eip155:42161': [{ deployment: allocationDeployment, toAllocate: true }],
    }
    const rules = {
      'eip155:42161': [
        {
          identifier: offchainDeployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.OFFCHAIN,
        } as IndexingRuleAttributes,
        {
          identifier: alwaysDeployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
        } as IndexingRuleAttributes,
      ],
    }

    const result = resolveTargetDeployments(allocationDecisions, rules, [
      offchainArgDeployment,
    ])

    // Should include: allocationDeployment, offchainDeployment, alwaysDeployment, offchainArgDeployment
    expect(result.size).toBe(4)
    expect(result).toContain(allocationDeployment)
    expect([...result].map(d => d.ipfsHash)).toContain(
      offchainDeployment.ipfsHash,
    )
    expect([...result].map(d => d.ipfsHash)).toContain(
      alwaysDeployment.ipfsHash,
    )
    expect([...result].map(d => d.ipfsHash)).toContain(
      offchainArgDeployment.ipfsHash,
    )
  })
})
