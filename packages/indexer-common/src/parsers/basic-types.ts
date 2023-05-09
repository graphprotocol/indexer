// Parser combinators for basic types

import P from 'parsimmon'
import { resolveChainId } from '../indexer-management/types'

// Checks if the provided network identifier is supported by the Indexer Agent.
function validateNetworkIdentifier(n: string): P.Parser<string> {
  try {
    const valid = resolveChainId(n)
    return P.succeed(valid)
  } catch (e) {
    return P.fail('a supported network identifier')
  }
}

// A basic URL parser.
export const url = P.regex(/^https?:.*/)
  .map((x) => new URL(x))
  .desc('a valid URL')

// Intermediary parser to tag either CAIP-2 ids or network aliases like 'mainnet' and 'arbitrum-one'.
// Source: https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md
const namespace_ = P.regex(/[-a-z0-9]{3,8}/).desc('a CAIP2 namespace, like eip155')
const colon = P.string(':').desc('a colon, separating CAIP2 namespace from its reference')
const reference = P.regex(/[-_a-zA-Z0-9]{1,32}/).desc('a CAIP2 reference')
const caip2Id = namespace_.then(colon).then(reference).chain(validateNetworkIdentifier)

// A valid human friendly network name / alias.
const networkAlias = P.regex(/[a-z-]+/).chain(validateNetworkIdentifier)

// Either a CAIP-2 or an alias.
export const networkIdentifier = P.alt(caip2Id, networkAlias)

// A basic `base58btc` parser for CIDv0 (IPFS Hashes)
export const base58 = P.regex(/^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/).desc(
  'An IPFS Content Identifer (Qm...)',
)
