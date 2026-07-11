import { activeAgreementRevertGuidance } from '../indexing-agreement-notices'

describe('activeAgreementRevertGuidance', () => {
  it('translates the close-guard revert into the opt-out command', () => {
    const guidance = activeAgreementRevertGuidance(
      'Error: execution reverted: SubgraphServiceAllocationHasActiveAgreement(0x3ec9, 0x7f31)',
    )
    expect(guidance).toContain('active indexing agreement')
    expect(guidance).toContain('graph indexer rules never')
  })

  it('leaves unrelated errors alone', () => {
    expect(activeAgreementRevertGuidance('Error: nonce too low')).toBeNull()
  })
})
