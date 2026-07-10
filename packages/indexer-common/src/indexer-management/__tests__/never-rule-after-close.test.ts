import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { neverRuleAfterClose } from '../allocations'
import { IndexingDecisionBasis, IndexingRuleAttributes } from '../models'
import { SubgraphIdentifierType } from '../../subgraphs'

// Pure-function coverage for the guard that stops confirmUnallocate from
// overwriting a DIPS rule with `never`, which would cancel the agreement.
describe('neverRuleAfterClose', () => {
  const deployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )
  const protocolNetwork = 'eip155:42161'

  const rule = (decisionBasis: IndexingDecisionBasis) =>
    ({
      identifier: deployment.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis,
      protocolNetwork,
    }) as IndexingRuleAttributes

  it('keeps a DIPS rule by returning no rule to write', () => {
    expect(
      neverRuleAfterClose(rule(IndexingDecisionBasis.DIPS), deployment, protocolNetwork),
    ).toBeNull()
  })

  it('stamps never when the deployment has no rule', () => {
    expect(neverRuleAfterClose(null, deployment, protocolNetwork)).toEqual({
      identifier: deployment.ipfsHash,
      protocolNetwork,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.NEVER,
    })
  })

  it('stamps never over non-DIPS rules so a close still sticks', () => {
    for (const basis of [
      IndexingDecisionBasis.ALWAYS,
      IndexingDecisionBasis.NEVER,
      IndexingDecisionBasis.OFFCHAIN,
      IndexingDecisionBasis.RULES,
    ]) {
      expect(
        neverRuleAfterClose(rule(basis), deployment, protocolNetwork)?.decisionBasis,
      ).toBe(IndexingDecisionBasis.NEVER)
    }
  })
})
