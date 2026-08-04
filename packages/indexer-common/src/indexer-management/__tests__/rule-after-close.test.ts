import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { ruleAfterClose } from '../allocations'
import { IndexingDecisionBasis, IndexingRuleAttributes } from '../models'
import { SubgraphIdentifierType } from '../../subgraphs'

// Pure-function coverage for the guard that stops the post-close rule stamp
// (never on the queued path, offchain on the direct path) from overwriting a
// DIPS rule, which the DIPS module reads as a blocklist.
describe('ruleAfterClose', () => {
  const deployment = new SubgraphDeploymentID(
    'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH',
  )
  const protocolNetwork = 'eip155:42161'
  const stampBases = [
    IndexingDecisionBasis.NEVER,
    IndexingDecisionBasis.OFFCHAIN,
  ] as const

  const rule = (decisionBasis: IndexingDecisionBasis) =>
    ({
      identifier: deployment.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis,
      protocolNetwork,
    }) as IndexingRuleAttributes

  it('keeps a DIPS rule by returning no rule to write, for either stamp', () => {
    for (const basis of stampBases) {
      expect(
        ruleAfterClose(
          rule(IndexingDecisionBasis.DIPS),
          deployment,
          protocolNetwork,
          basis,
        ),
      ).toBeNull()
    }
  })

  it('stamps the requested basis when the deployment has no rule', () => {
    for (const basis of stampBases) {
      expect(ruleAfterClose(null, deployment, protocolNetwork, basis)).toEqual({
        identifier: deployment.ipfsHash,
        protocolNetwork,
        identifierType: SubgraphIdentifierType.DEPLOYMENT,
        decisionBasis: basis,
      })
    }
  })

  it('stamps over non-DIPS rules so a close still sticks', () => {
    for (const existing of [
      IndexingDecisionBasis.ALWAYS,
      IndexingDecisionBasis.NEVER,
      IndexingDecisionBasis.OFFCHAIN,
      IndexingDecisionBasis.RULES,
    ]) {
      expect(
        ruleAfterClose(
          rule(existing),
          deployment,
          protocolNetwork,
          IndexingDecisionBasis.NEVER,
        )?.decisionBasis,
      ).toBe(IndexingDecisionBasis.NEVER)
    }
  })
})
