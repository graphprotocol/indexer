import { validateNetworkIdentifier } from '../validators'

describe('validateNetworkIdentifier tests', () => {
  it('should parse valid network identifiers', () => {
    expect(validateNetworkIdentifier('sepolia')).toBe('eip155:11155111')
    expect(validateNetworkIdentifier('mainnet')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:1')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:421614')).toBe('eip155:421614')
  })
})
