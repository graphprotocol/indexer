import { Logger } from '@graphprotocol/common-ts'
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
  private logger: Logger

  constructor(
    logger: Logger,
    payersBalances: Map<string, bigint>,
    receiversTokensCollected: Map<string, bigint>,
  ) {
    this.logger = logger
    this.payersBalances = payersBalances
    this.receiversTokensCollected = receiversTokensCollected
  }

  getBalanceForPayer(payer: string): bigint {
    const balance = this.payersBalances.get(payer.toLowerCase())
    if (balance === undefined) {
      throw new Error(`No balance found for payer: ${payer}`)
    }
    return balance
  }

  getTokensCollectedForReceiver(payer: string, collectionId: string): bigint {
    const balance = this.receiversTokensCollected.get(
      `${payer.toLowerCase()}-${collectionId.toLowerCase()}`,
    )
    if (balance === undefined) {
      this.logger.debug(
        'No tokens collected found for payer and collectionId. Assuming 0.',
        {
          payer,
          collectionId,
        },
      )
    }
    return balance ?? BigInt(0)
  }

  updateBalances(payer: string, collectionId: string, value: bigint) {
    // payer balance
    const balance = this.getBalanceForPayer(payer)
    if (balance < value) {
      throw new Error(`Negative balances are not allowed`)
    }
    const newBalance = balance - value
    this.payersBalances.set(payer.toLowerCase(), newBalance)

    // receiver tokens collected
    const tokensCollected = this.getTokensCollectedForReceiver(payer, collectionId)
    this.receiversTokensCollected.set(
      `${payer.toLowerCase()}-${collectionId.toLowerCase()}`,
      tokensCollected + value,
    )
  }

  static fromResponse(
    logger: Logger,
    response: PaymentsEscrowAccountResponse,
  ): PaymentsEscrowAccounts {
    const payersBalances = new Map<string, bigint>()
    const tokensCollected = new Map<string, bigint>()

    response.paymentsEscrowAccounts.forEach((account) => {
      payersBalances.set(account.payer.id.toLowerCase(), BigInt(account.balance))
    })

    // not a typo, graph-client pluralization awesomeness
    response.graphTallyTokensCollecteds.forEach((token) => {
      tokensCollected.set(
        `${token.payer.id.toLowerCase()}-${token.collectionId.toLowerCase()}`,
        BigInt(token.tokens),
      )
    })

    return new PaymentsEscrowAccounts(logger, payersBalances, tokensCollected)
  }
}

export const getEscrowAccounts = async (
  logger: Logger,
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
  logger.trace('Payments escrow accounts', {
    indexer,
    collector: collectorAddress,
    accounts: result.data,
  })
  if (!result.data) {
    throw `There was an error while querying Network Subgraph. Errors: ${result.error}`
  }

  return PaymentsEscrowAccounts.fromResponse(logger, result.data)
}
