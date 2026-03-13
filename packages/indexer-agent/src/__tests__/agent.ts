import {
  Agent,
  convertSubgraphBasedRulesToDeploymentBased,
  consolidateAllocationDecisions,
  resolveTargetDeployments,
} from '../agent'
import {
  ActivationCriteria,
  Allocation,
  AllocationDecision,
  AllocationStatus,
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

describe('reconcileDeploymentAllocationAction', () => {
  const deployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockLogger: any = {
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  }

  const activeAllocations: Allocation[] = [
    {
      id: '0x0000000000000000000000000000000000000001',
      status: AllocationStatus.ACTIVE,
      isLegacy: false,
      subgraphDeployment: {
        id: deployment,
        ipfsHash: deployment.ipfsHash,
      },
      indexer: '0x0000000000000000000000000000000000000000',
      allocatedTokens: BigInt(1000),
      createdAt: 0,
      createdAtEpoch: 1,
      createdAtBlockHash: '0x0',
      closedAt: 0,
      closedAtEpoch: 0,
      closedAtEpochStartBlockHash: undefined,
      previousEpochStartBlockHash: undefined,
      closedAtBlockHash: '0x0',
      poi: undefined,
      queryFeeRebates: undefined,
      queryFeesCollected: undefined,
    } as unknown as Allocation,
  ]

  const decision = new AllocationDecision(
    deployment,
    {
      identifier: deployment.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      allocationAmount: '1000',
      decisionBasis: IndexingDecisionBasis.RULES,
    } as IndexingRuleAttributes,
    true,
    ActivationCriteria.SIGNAL_THRESHOLD,
    'eip155:42161',
  )

  function createAgent() {
    const agent = Object.create(Agent.prototype)
    agent.logger = mockLogger
    agent.graphNode = {
      indexingStatus: jest.fn().mockResolvedValue([
        {
          subgraphDeployment: { ipfsHash: deployment.ipfsHash },
          health: 'healthy',
        },
      ]),
    }
    agent.identifyExpiringAllocations = jest
      .fn()
      .mockResolvedValue([activeAllocations[0]])
    return agent
  }

  function createOperator() {
    return {
      closeEligibleAllocations: jest.fn(),
      createAllocation: jest.fn(),
      refreshExpiredAllocations: jest.fn(),
    }
  }

  function createNetwork(isHorizon: boolean) {
    return {
      isHorizon: { value: jest.fn().mockResolvedValue(isHorizon) },
      specification: { networkIdentifier: 'eip155:42161' },
      networkMonitor: {
        closedAllocations: jest.fn().mockResolvedValue([]),
      },
    }
  }

  it('should not call refreshExpiredAllocations for Horizon allocations', async () => {
    const agent = createAgent()
    const operator = createOperator()
    const network = createNetwork(true)

    await agent.reconcileDeploymentAllocationAction(
      decision,
      activeAllocations,
      10,
      { value: jest.fn().mockResolvedValue(28) },
      network,
      operator,
      false,
    )

    expect(operator.refreshExpiredAllocations).not.toHaveBeenCalled()
    expect(agent.identifyExpiringAllocations).not.toHaveBeenCalled()
  })

  it('should call refreshExpiredAllocations for legacy allocations', async () => {
    const agent = createAgent()
    const operator = createOperator()
    const network = createNetwork(false)

    await agent.reconcileDeploymentAllocationAction(
      decision,
      activeAllocations,
      10,
      { value: jest.fn().mockResolvedValue(28) },
      network,
      operator,
      false,
    )

    expect(agent.identifyExpiringAllocations).toHaveBeenCalled()
    expect(operator.refreshExpiredAllocations).toHaveBeenCalledWith(
      expect.anything(),
      decision,
      [activeAllocations[0]],
      false,
    )
  })
})
