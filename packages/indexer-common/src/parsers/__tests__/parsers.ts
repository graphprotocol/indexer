import { validateNetworkIdentifier } from '../validators'

describe('validateNetworkIdentifier tests', () => {
  it('should parse valid network identifiers', () => {
    expect(validateNetworkIdentifier('goerli')).toBe('eip155:5')
    expect(validateNetworkIdentifier('mainnet')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:1')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:5')).toBe('eip155:5')
  })
})
