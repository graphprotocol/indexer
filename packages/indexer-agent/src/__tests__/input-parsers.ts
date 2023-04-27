import { parseTaggedUrl, parseTaggedIpfsHash } from '../commands/input-parsers'

const testUrlString = 'https://example.com/path/to/resource'
const testUrl = new URL(testUrlString)
const testCid = 'QmRKs2ZfuwvmZA3QAWmCqrGUjV9pxtBUDP3wuc6iVGnjA2'

describe('parseTaggedUrl tests', () => {
  it('should parse a URL without network id', () => {
    const expected = { networkId: null, url: testUrl }
    const actual = parseTaggedUrl(testUrlString)
    expect(actual).toEqual(expected)
  })

  it('should parse a URL prefixed with a network CAIP-2 id', () => {
    const input = `eip155:1:${testUrlString}`
    const expected = {
      networkId: 'eip155:1',
      url: testUrl,
    }
    const actual = parseTaggedUrl(input)
    expect(actual).toEqual(expected)
  })

  it('should parse a URL prefixed with a network network alias', () => {
    const input = `arbitrum-one:${testUrlString}`
    const expected = {
      networkId: 'eip155:42161',
      url: testUrl,
    }
    const actual = parseTaggedUrl(input)
    expect(actual).toEqual(expected)
  })

  it('should throw an error if the input is not a valid URL', () => {
    expect(() => parseTaggedUrl('not-a-valid-url')).toThrow()
  })

  it('should throw an error if the input is not a valid URL, even if prefixed with a valid network id', () => {
    expect(() => parseTaggedUrl('mainnet:not-a-valid-url')).toThrow()
  })

  it('should throw an error if the network id is not supported', () => {
    const input = 'eip155:0:${testUrlString}'
    expect(() => parseTaggedUrl(input)).toThrow()
  })

  it('should throw an error if the network id is malformed', () => {
    const input = 'not/a/chain/alias:${testUrlString}'
    expect(() => parseTaggedUrl(input)).toThrow()
  })
})

describe('parseTaggedIpfsHash tests', () => {
  it('should parse an IPFS hash without network id', () => {
    const expected = { networkId: null, cid: testCid }
    const actual = parseTaggedIpfsHash(testCid)
    expect(actual).toEqual(expected)
  })

  it('should parse an IPFS hash prefixed with a network id', () => {
    const input = `eip155:1:${testCid}`
    const expected = { networkId: 'eip155:1', cid: testCid }
    const actual = parseTaggedIpfsHash(input)
    expect(actual).toEqual(expected)
  })

  it('should parse an IPFS Hash prefixed with a network network alias', () => {
    const input = `goerli:${testCid}`
    const expected = { networkId: 'eip155:5', cid: testCid }
    const actual = parseTaggedIpfsHash(input)
    expect(actual).toEqual(expected)
  })

  it('should throw an error if the input is not a valid IPFS Hash', () => {
    expect(() => parseTaggedIpfsHash('not-a-valid-ipfs-hash')).toThrow()
  })

  it('should throw an error if the input is not a valid IPFS Hash, even if prefixed with a valid network id', () => {
    expect(() => parseTaggedIpfsHash('mainnet:not-a-valid-ipfs-hash')).toThrow()
  })

  it('should throw an error if the network id is not supported', () => {
    const input = 'eip155:0:${testCid}'
    expect(() => parseTaggedIpfsHash(input)).toThrow()
  })

  it('should throw an error if the network id is malformed', () => {
    const input = 'not/a/chain/alias:${testCid}'
    expect(() => parseTaggedIpfsHash(input)).toThrow()
  })
})
