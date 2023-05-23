import { validateNetworkIdentifier } from '../validators'

const testUrlString = 'https://example.com/path/to/resource'
const testUrl = new URL(testUrlString)
const testCid = 'QmRKs2ZfuwvmZA3QAWmCqrGUjV9pxtBUDP3wuc6iVGnjA2'

describe('validateNetworkIdentifier tests', () => {
  it('should parse valid network identifiers', () => {
    expect(validateNetworkIdentifier('goerli')).toBe('eip155:5')
    expect(validateNetworkIdentifier('mainnet')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:1')).toBe('eip155:1')
    expect(validateNetworkIdentifier('eip155:5')).toBe('eip155:5')
  })
})
