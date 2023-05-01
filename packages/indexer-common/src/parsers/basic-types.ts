// Parser combinators for basic types

import P from 'parsimmon'
import { resolveChainId } from '..'

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
export const url = P.regex(/^https?:.*/)
  .map((x) => new URL(x))
  .desc('a valid URL')

// Intermediary parser to tag either CAIP-2 ids or network aliases like 'mainnet' and 'arbitrum-one'.
const caip2Id = P.regex(/[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/).chain(
  validateNetworkIdentifier,
)

// A valid human friendly network name / alias.
const networkAlias = P.regex(/[a-z-]+/).chain(validateNetworkIdentifier)

// Either a CAIP-2 or an alias.
export const networkIdentifier = P.alt(caip2Id, networkAlias)

// A basic `base58btc` parser for CIDv0 (IPFS Hashes)
export const base58 = P.regex(/^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/).desc(
  'An IPFS Content Identifer (Qm...)',
)
