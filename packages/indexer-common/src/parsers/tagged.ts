// Parser combinators for values prefixed (tagged) by a network identifier

import P from 'parsimmon'
import { networkIdentifier, url, base58 } from './basic-types'

export interface MaybeTaggedUrl {
  networkId: string | null
  url: URL
}

export interface MaybeTaggedIpfsHash {
  networkId: string | null
  cid: string
}

// A tag followed by a colon.
const prefixTag = networkIdentifier.skip(P.string(':'))

// Intermediary parser that can detect a 'network identifier and an URL separated by a colon.
// Returns a `MaybeTaggedUrl` tagged with the network identifier.
const taggedUrl = P.seqMap(prefixTag, url, (networkId, url) => ({
  networkId,
  url,
}))

// Intermediary parser to convert an URL to a `MaybeTaggedUrl`, in its untagged form.
const untaggedUrl = url.map((url) => ({
  networkId: null,
  url,
}))

// Final parser that can handle both tagged and untagged URLs
export const maybeTaggedUrl = P.alt(taggedUrl, untaggedUrl)

// Intermediary parser that can detect a 'network identifier and an IPFS hash separated by a colon.
// Returns a `MaybeTaggedIpfsHash` tagged with the network identifier..
const taggedIpfs = P.seqMap(prefixTag, base58, (networkId, cid) => ({
  networkId,
  cid,
}))

// Intermediary parser to convert an IPFS Hash to a `MaybeTaggedIpfsHash`, in its untagged form.
const untaggedIpfs = base58.map((cid) => ({ networkId: null, cid }))

// Final parser that can handle both tagged and untagged IPFS Hashes.
export const maybeTaggedIpfsHash = P.alt(taggedIpfs, untaggedIpfs)
