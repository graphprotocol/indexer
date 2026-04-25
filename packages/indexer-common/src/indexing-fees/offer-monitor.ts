import { Logger } from '@graphprotocol/common-ts'
import gql from 'graphql-tag'
import { SubgraphClient } from '../subgraph-client'

const OFFER_EXISTS_QUERY = gql`
  query offerExists($id: ID!) {
    offer(id: $id) {
      id
    }
  }
`

/**
 * Checks the indexing-payments-subgraph for the presence of an `Offer`
 * entity. Used by the DIPs accept path to gate `acceptIndexingAgreement`
 * on dipper's `offer()` tx having landed on-chain; without this gate the
 * contract reverts with `RecurringCollectorInvalidSigner` whenever the
 * agent's poll beats dipper's submission.
 *
 * Subgraph errors are treated as "not yet" (transient) — better to wait
 * one more tick than to false-positive a rejection on a momentary
 * subgraph hiccup.
 */
export class OfferMonitor {
  constructor(
    private readonly logger: Logger,
    private readonly subgraph: SubgraphClient,
  ) {}

  async offerExists(agreementId: string): Promise<boolean> {
    try {
      const result = await this.subgraph.query(OFFER_EXISTS_QUERY, {
        id: agreementId.toLowerCase(),
      })
      if (result.error) {
        this.logger.debug(
          'Offer existence check failed (will retry on next tick)',
          { agreementId, err: result.error },
        )
        return false
      }
      return Boolean(result.data?.offer)
    } catch (err) {
      this.logger.debug(
        'Offer existence check threw (will retry on next tick)',
        { agreementId, err },
      )
      return false
    }
  }
}
