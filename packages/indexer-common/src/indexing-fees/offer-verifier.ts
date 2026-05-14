import gql from 'graphql-tag'
import { Logger } from '@graphprotocol/common-ts'
import { SubgraphClient } from '../subgraph-client'

export type OfferCheckResult =
  | { status: 'present'; offerHash: string }
  | { status: 'not_yet' }
  | { status: 'hash_mismatch'; onChainHash: string }
  | { status: 'unavailable' }

const OFFER_QUERY = gql`
  query GetOffer($id: Bytes!) {
    offer(id: $id) {
      offerHash
    }
  }
`

// Pre-flights the on-chain RCA offer via the indexing-payments-subgraph.
//
// - `present`: an Offer entity exists for the agreement id and its offerHash
//   matches the locally-computed expected hash; safe to send accept tx.
// - `not_yet`: subgraph returned no Offer entity. Producer either hasn't
//   called RecurringCollector.offer() yet or the subgraph is lagging the
//   chain head. Caller should leave the row pending and retry.
// - `hash_mismatch`: an Offer exists but its hash differs from expected.
//   Real producer/consumer disagreement; caller should reject the row.
// - `unavailable`: subgraph HTTP/GraphQL error. Treat as transient.
export class OfferVerifier {
  constructor(
    private subgraph: SubgraphClient,
    private logger: Logger,
  ) {}

  async checkOffer(agreementId: string, expectedHash: string): Promise<OfferCheckResult> {
    let result: { data?: { offer: { offerHash: string } | null }; errors?: unknown }
    try {
      result = await this.subgraph.query(OFFER_QUERY, { id: agreementId })
    } catch (err) {
      this.logger.warn('Offer pre-flight: subgraph query threw', {
        agreementId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { status: 'unavailable' }
    }

    if (result.errors) {
      this.logger.warn('Offer pre-flight: subgraph returned GraphQL errors', {
        agreementId,
        errors: result.errors,
      })
      return { status: 'unavailable' }
    }

    const offer = result.data?.offer
    if (!offer) {
      return { status: 'not_yet' }
    }

    const onChainHash = offer.offerHash.toLowerCase()
    if (onChainHash === expectedHash.toLowerCase()) {
      return { status: 'present', offerHash: offer.offerHash }
    }

    return { status: 'hash_mismatch', onChainHash: offer.offerHash }
  }
}
