import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  findRuleRequestingAllocation,
  isOptOutReason,
  staleQueuedCloses,
} from '../allocations'
import {
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  INDEXING_RULE_GLOBAL,
} from '../models'
import {
  ActivationCriteria,
  AllocationDecision,
  SubgraphIdentifierType,
} from '../../subgraphs'
import { ActionType, RECONCILE_ACTION_SOURCE } from '../../actions'
import { Action } from '../models/action'

// Pure-function coverage for the guard that stops confirmUnallocate stamping a
// `never` rule over an operator rule that currently requests allocation.
describe('findRuleRequestingAllocation', () => {
  const deployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )
  const otherDeployment = new SubgraphDeploymentID(
    'QmRKs2ZfuwvmZA3QAWmCqrGUjV9pxtBUDP3wuc6iVGnjA2',
  )

  const rule = (overrides: Partial<IndexingRuleAttributes>) =>
    ({
      identifier: deployment.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.ALWAYS,
      ...overrides,
    }) as IndexingRuleAttributes

  it('finds an always rule for the deployment', () => {
    const found = findRuleRequestingAllocation([rule({})], deployment)
    expect(found?.decisionBasis).toBe(IndexingDecisionBasis.ALWAYS)
  })

  it('finds a dips rule for the deployment', () => {
    const found = findRuleRequestingAllocation(
      [rule({ decisionBasis: IndexingDecisionBasis.DIPS })],
      deployment,
    )
    expect(found?.decisionBasis).toBe(IndexingDecisionBasis.DIPS)
  })

  it('matches a rule whose identifier is stored in bytes32 form', () => {
    const found = findRuleRequestingAllocation(
      [rule({ identifier: deployment.bytes32 })],
      deployment,
    )
    expect(found).toBeDefined()
  })

  it('ignores opt-out and default bases', () => {
    for (const basis of [
      IndexingDecisionBasis.NEVER,
      IndexingDecisionBasis.OFFCHAIN,
      IndexingDecisionBasis.RULES,
    ]) {
      expect(
        findRuleRequestingAllocation([rule({ decisionBasis: basis })], deployment),
      ).toBeUndefined()
    }
  })

  it('ignores rules for other deployments', () => {
    expect(
      findRuleRequestingAllocation(
        [rule({ identifier: otherDeployment.ipfsHash })],
        deployment,
      ),
    ).toBeUndefined()
  })

  it('ignores subgraph-type rules and returns undefined when no rules exist', () => {
    expect(
      findRuleRequestingAllocation(
        [rule({ identifierType: SubgraphIdentifierType.SUBGRAPH })],
        deployment,
      ),
    ).toBeUndefined()
    expect(findRuleRequestingAllocation([], deployment)).toBeUndefined()
  })

  const globalRule = (basis: IndexingDecisionBasis) =>
    ({
      identifier: INDEXING_RULE_GLOBAL,
      identifierType: SubgraphIdentifierType.GROUP,
      decisionBasis: basis,
    }) as IndexingRuleAttributes

  it('falls back to a global always rule when no specific rule exists', () => {
    const found = findRuleRequestingAllocation(
      [globalRule(IndexingDecisionBasis.ALWAYS)],
      deployment,
    )
    expect(found?.identifier).toBe(INDEXING_RULE_GLOBAL)
  })

  it('lets a specific opt-out rule override a global always rule', () => {
    expect(
      findRuleRequestingAllocation(
        [
          rule({ decisionBasis: IndexingDecisionBasis.NEVER }),
          globalRule(IndexingDecisionBasis.ALWAYS),
        ],
        deployment,
      ),
    ).toBeUndefined()
  })
})

// The reason recorded at queue time is `<identifierType>:<criteria>`; only the
// never/offchain criteria mark a close that an opt-out rule decided.
describe('isOptOutReason', () => {
  it('recognises opt-out criteria regardless of the rule flavour prefix', () => {
    for (const reason of ['deployment:never', 'deployment:offchain', 'group:offchain']) {
      expect(isOptOutReason(reason)).toBe(true)
    }
  })

  it('rejects allocate-worthy, gate, and manual reasons', () => {
    for (const reason of [
      'deployment:always',
      'deployment:dips',
      'deployment:min_stake',
      'deployment:unsupported',
      'deployment:none',
      'none:na',
      'manual',
    ]) {
      expect(isOptOutReason(reason)).toBe(false)
    }
  })

  // Lock isOptOutReason to the exact format reconcile records: the reason on a
  // queued close is AllocationDecision.reasonString(), not a hand-written string.
  it('stays in lockstep with the reason format reconcile records', () => {
    const deployment = new SubgraphDeploymentID(
      'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
    )
    const decision = (basis: IndexingDecisionBasis, criteria: ActivationCriteria) =>
      new AllocationDecision(
        deployment,
        {
          identifier: deployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: basis,
        } as IndexingRuleAttributes,
        false,
        criteria,
        'eip155:42161',
      )
    expect(
      isOptOutReason(
        decision(
          IndexingDecisionBasis.OFFCHAIN,
          ActivationCriteria.OFFCHAIN,
        ).reasonString(),
      ),
    ).toBe(true)
    expect(
      isOptOutReason(
        decision(IndexingDecisionBasis.NEVER, ActivationCriteria.NEVER).reasonString(),
      ),
    ).toBe(true)
    expect(
      isOptOutReason(
        decision(IndexingDecisionBasis.ALWAYS, ActivationCriteria.ALWAYS).reasonString(),
      ),
    ).toBe(false)
  })
})

describe('staleQueuedCloses', () => {
  const deployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )
  const alwaysRule = {
    identifier: deployment.ipfsHash,
    identifierType: SubgraphIdentifierType.DEPLOYMENT,
    decisionBasis: IndexingDecisionBasis.ALWAYS,
  } as IndexingRuleAttributes

  const close = (overrides: Partial<Action>) =>
    ({
      id: 1,
      type: ActionType.UNALLOCATE,
      source: RECONCILE_ACTION_SOURCE,
      reason: 'deployment:offchain',
      deploymentID: deployment.ipfsHash,
      ...overrides,
    }) as Action

  it('matches a reconcile-queued opt-out close whose rule now says allocate', () => {
    expect(staleQueuedCloses([close({})], [alwaysRule])).toHaveLength(1)
  })

  it('never matches manual or API closes, other action types, or current closes', () => {
    expect(
      staleQueuedCloses([close({ source: 'indexerCLI' })], [alwaysRule]),
    ).toHaveLength(0)
    expect(staleQueuedCloses([close({ reason: 'manual' })], [alwaysRule])).toHaveLength(0)
    expect(
      staleQueuedCloses([close({ type: ActionType.ALLOCATE })], [alwaysRule]),
    ).toHaveLength(0)
    expect(
      staleQueuedCloses([close({ reason: 'deployment:always' })], [alwaysRule]),
    ).toHaveLength(0)
    expect(staleQueuedCloses([close({})], [])).toHaveLength(0)
  })
})
