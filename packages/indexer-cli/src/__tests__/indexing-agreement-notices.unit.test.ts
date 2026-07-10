import {
  activeAgreementRevertGuidance,
  closedAllocationAgreementNotice,
  isDipsManagedRule,
  queuedUnallocateAgreementWarning,
} from '../indexing-agreement-notices'
import {
  IndexingDecisionBasis,
  IndexingRuleAttributes,
} from '@graphprotocol/indexer-common'

const DEPLOYMENT = 'QmXZiV6S13ha6QXq4dmaM3TB4CHcDxBMvGexSNu9Kc28EH'

describe('isDipsManagedRule', () => {
  it('matches only rules with the DIPS decision basis', () => {
    expect(
      isDipsManagedRule({
        decisionBasis: IndexingDecisionBasis.DIPS,
      } as Partial<IndexingRuleAttributes>),
    ).toBe(true)
    for (const basis of [
      IndexingDecisionBasis.ALWAYS,
      IndexingDecisionBasis.NEVER,
      IndexingDecisionBasis.OFFCHAIN,
      IndexingDecisionBasis.RULES,
    ]) {
      expect(
        isDipsManagedRule({ decisionBasis: basis } as Partial<IndexingRuleAttributes>),
      ).toBe(false)
    }
    expect(isDipsManagedRule(null)).toBe(false)
    expect(isDipsManagedRule(undefined)).toBe(false)
  })
})

describe('notices', () => {
  it('names the opt-out command after a close on a DIPS deployment', () => {
    const notice = closedAllocationAgreementNotice(DEPLOYMENT, 'arbitrum-one')
    expect(notice).toContain(
      `graph indexer rules never ${DEPLOYMENT} --network arbitrum-one`,
    )
    expect(notice).toContain('payments for it stop')
  })

  it('names the action cancel command after queueing an unallocate', () => {
    const warning = queuedUnallocateAgreementWarning(42, 'arbitrum-one')
    expect(warning).toContain('graph indexer actions cancel 42 --network arbitrum-one')
  })
})

describe('activeAgreementRevertGuidance', () => {
  it('translates the close-guard revert into the opt-out command', () => {
    const guidance = activeAgreementRevertGuidance(
      'Error: execution reverted (unknown custom error) SubgraphServiceAllocationHasActiveAgreement(0x3ec9, 0x7f31)',
      DEPLOYMENT,
      'arbitrum-one',
    )
    expect(guidance).toContain(
      `graph indexer rules never ${DEPLOYMENT} --network arbitrum-one`,
    )
  })

  it('falls back to a placeholder when the deployment is unknown', () => {
    const guidance = activeAgreementRevertGuidance(
      'SubgraphServiceAllocationHasActiveAgreement',
      undefined,
      'arbitrum-one',
    )
    expect(guidance).toContain('<deployment>')
  })

  it('leaves unrelated errors alone', () => {
    expect(
      activeAgreementRevertGuidance('Error: nonce too low', DEPLOYMENT, 'arbitrum-one'),
    ).toBeNull()
  })
})
