import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { findRuleRequestingAllocation } from '../allocations'
import { IndexingDecisionBasis, IndexingRuleAttributes } from '../models'
import { SubgraphIdentifierType } from '../../subgraphs'

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
})
