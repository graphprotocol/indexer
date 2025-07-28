import { SubgraphClient } from '../subgraph-client'
import gql from 'graphql-tag'

export type PaymentsEscrowAccountResponse = {
  paymentsEscrowAccounts: {
    balance: string
    payer: {
      id: string
    }
  }[]
  // Not a typo just how graph-client pluralizes the field name
  graphTallyTokensCollecteds: {
    tokens: string
    collectionId: string
    payer: {
      id: string
    }
  }[]
}

export class PaymentsEscrowAccounts {
  private payersBalances: Map<string, bigint>
  private receiversTokensCollected: Map<string, bigint>

  constructor(
    payersBalances: Map<string, bigint>,
    receiversTokensCollected: Map<string, bigint>,
  ) {
    this.payersBalances = payersBalances
    this.receiversTokensCollected = receiversTokensCollected
  }

  getBalanceForPayer(payer: string): bigint {
    const balance = this.payersBalances.get(payer)
    if (balance === undefined) {
      throw new Error(`No balance found for payer: ${payer}`)
    }
    return balance
  }

  getTokensCollectedForReceiver(payer: string, collectionId: string): bigint {
    const balance = this.receiversTokensCollected.get(`${payer}-${collectionId}`)
    if (balance === undefined) {
      throw new Error(
        `No tokens collected found for payer: ${payer} and collectionId: ${collectionId}`,
      )
    }
    return balance
  }

  updateBalances(payer: string, collectionId: string, value: bigint) {
    // payer balance
    const balance = this.getBalanceForPayer(payer)
    if (balance < value) {
      throw new Error(`Negative balances are not allowed`)
    }
    const newBalance = balance - value
    this.payersBalances.set(payer, newBalance)

    // receiver tokens collected
    const tokensCollected = this.getTokensCollectedForReceiver(payer, collectionId)
    this.receiversTokensCollected.set(`${payer}-${collectionId}`, tokensCollected + value)
  }

  static fromResponse(response: PaymentsEscrowAccountResponse): PaymentsEscrowAccounts {
    const payersBalances = new Map<string, bigint>()
    const tokensCollected = new Map<string, bigint>()

    response.paymentsEscrowAccounts.forEach((account) => {
      payersBalances.set(account.payer.id, BigInt(account.balance))
    })

    response.graphTallyTokensCollecteds.forEach((token) => {
      tokensCollected.set(`${token.payer.id}-${token.collectionId}`, BigInt(token.tokens))
    })

    return new PaymentsEscrowAccounts(payersBalances, tokensCollected)
  }
}

export const getEscrowAccounts = async (
  subgraph: SubgraphClient,
  indexer: string,
  collectorAddress: string,
): Promise<PaymentsEscrowAccounts> => {
  const result = await subgraph.query<PaymentsEscrowAccountResponse>(
    gql`
      query PaymentsEscrowAccountQuery($indexer: ID!, $collector: String!) {
        paymentsEscrowAccounts(
          where: { receiver_: { id: $indexer }, collector: $collector }
        ) {
          balance
          payer {
            id
          }
        }
        graphTallyTokensCollecteds(where: { receiver_: { id: $indexer } }) {
          tokens
          collectionId
          payer {
            id
          }
        }
      }
    `,
    { indexer, collector: collectorAddress },
  )
  if (!result.data) {
    throw `There was an error while querying Network Subgraph. Errors: ${result.error}`
  }

  return PaymentsEscrowAccounts.fromResponse(result.data)
}
