import P from 'parsimmon'
import { resolveChainId } from '@graphprotocol/indexer-common'

interface MaybeTaggedUrl {
  networkId: string | null
  url: URL
}

interface MaybeTaggedIpfsHash {
  networkId: string | null
  cid: string
}

// Checks if the provided network identifier is supported by the Indexer Agent.
function validateNetworkIdentifier(n: string): P.Parser<any> {
  try {
    const valid = resolveChainId(n)
    return P.succeed(valid)
  } catch {
    return P.fail('a supported network identifier')
  }
}

// A basic URL parser.
const url = P.regex(/^https?:.*/)
  .map(x => new URL(x))
  .desc('a valid URL')

// Intermediary parser to tag either CAIP-2 ids or network aliases like 'mainnet' and 'arbitrum-one'.
const caip2Id = P.string('eip155:').then(
  P.regex(/[0-9]+/).chain(validateNetworkIdentifier),
)
// A valid human friendly network name / alias.
const alias = P.regex(/[a-z-]+/).chain(validateNetworkIdentifier)

// Either a CAIP-2 or an alias.
const tag = P.alt(caip2Id, alias)

// A tag followed by a colon.
const prefixTag = tag.skip(P.string(':'))

// Intermediary parser that can detect a 'network identifier and an URL separated by a colon.
// Returns a `MaybeTaggedUrl` tagged with the network identifier.
const taggedUrl = P.seqMap(prefixTag, url, (networkId, url) => ({
  networkId,
  url,
}))

// Intermediary parser to convert an URL to a `MaybeTaggedUrl`, in its untagged form.
const untaggedUrl = url.map(url => ({
  networkId: null,
  url,
}))

// Final parser that can handle both tagged and untagged URLs
const maybeTaggedUrl = P.alt(taggedUrl, untaggedUrl)

// A basic `base58btc` parser for CIDv0
const base58 = P.regex(/^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/).desc(
  'An IPFS Content Identifer (Qm...)',
)

// Intermediary parser that can detect a 'network identifier and an IPFS hash separated by a colon.
// Returns a `MaybeTaggedIpfsHash` tagged with the network identifier..
const taggedIpfs = P.seqMap(prefixTag, base58, (networkId, cid) => ({
  networkId,
  cid,
}))

// Intermediary parser to convert an IPFS Hash to a `MaybeTaggedIpfsHash`, in its untagged form.
const untaggedIpfs = base58.map(cid => ({ networkId: null, cid }))

// Final parser that can handle both tagged and untagged IPFS Hashes.
const maybeTaggedIpfsHash = P.alt(taggedIpfs, untaggedIpfs)

// Generic function that takes a parser of type T and attempts to parse it from a string. If it
// fails, then it will throw an error with an explanation of what was expected, as well as the
// portion of the input that was parsed and what's remaining to parse.
function parse<T>(parser: P.Parser<T>, input: string): T {
  const parseResult = parser.parse(input)
  if (parseResult.status) {
    return parseResult.value
  }
  const expected = parseResult.expected[0]
  const parsed = input.slice(0, parseResult.index.offset)
  const remaining = input.slice(parseResult.index.offset)
  throw new Error(
    `Failed to parse "${input}". Expected: ${expected}. Parsed up to: "${parsed}". Remaining: "${remaining}"`,
  )
}

export function parseTaggedUrl(input: string): MaybeTaggedUrl {
  return parse(maybeTaggedUrl, input)
}
export function parseTaggedIpfsHash(input: string): MaybeTaggedIpfsHash {
  return parse(maybeTaggedIpfsHash, input)
}
