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
  const accounts: PaymentsEscrowAccountResponse = {
    paymentsEscrowAccounts: [],
    graphTallyTokensCollecteds: [],
  }
  const pageSize = 1000
  let accountCursor = ''
  let collectedCursor = ''
  let accountsDone = false
  let collectedDone = false
  let block: { hash: string } | undefined

  type Page = {
    paymentsEscrowAccounts: (PaymentsEscrowAccountResponse['paymentsEscrowAccounts'][number] & {
      id: string
    })[]
    graphTallyTokensCollecteds: (PaymentsEscrowAccountResponse['graphTallyTokensCollecteds'][number] & {
      id: string
    })[]
    _meta: { block: { hash: string } }
  }

  // Each entity has an independent cursor, but every page must describe the same
  // chain snapshot. Never treat a missing/failed page as zero collected tokens.
  while (!accountsDone || !collectedDone) {
    const result = await subgraph.query<Page>(
      gql`
        query PaymentsEscrowAccountQuery(
          $indexer: ID!
          $collector: String!
          $accountCursor: String!
          $collectedCursor: String!
          $accountsFirst: Int!
          $collectedFirst: Int!
          $block: Block_height
        ) {
          paymentsEscrowAccounts(
            first: $accountsFirst
            orderBy: id
            orderDirection: asc
            block: $block
            where: {
              receiver_: { id: $indexer }
              collector: $collector
              id_gt: $accountCursor
            }
          ) {
            id
            balance
            payer {
              id
            }
          }
          graphTallyTokensCollecteds(
            first: $collectedFirst
            orderBy: id
            orderDirection: asc
            block: $block
            where: { receiver_: { id: $indexer }, id_gt: $collectedCursor }
          ) {
            id
            tokens
            collectionId
            payer {
              id
            }
          }
          _meta(block: $block) {
            block {
              hash
            }
          }
        }
      `,
      {
        indexer,
        collector: collectorAddress,
        accountCursor,
        collectedCursor,
        accountsFirst: accountsDone ? 0 : pageSize,
        collectedFirst: collectedDone ? 0 : pageSize,
        block,
      },
    )
    if (result.error || !result.data) {
      throw new Error(`Failed to query payments escrow accounts: ${result.error}`)
    }
    const hash = result.data._meta?.block?.hash
    if (!hash || (block && hash !== block.hash)) {
      throw new Error('Missing or inconsistent block hash in payments escrow accounts')
    }
    block = { hash }
    const page = result.data
    // Validate progress even within a page: repeating or rewinding ids must not
    // silently produce a partial snapshot or an infinite pagination loop.
    for (const account of page.paymentsEscrowAccounts) {
      if (!account.id || account.id <= accountCursor) {
        throw new Error('Payments escrow account cursor did not advance')
      }
      accountCursor = account.id
      accounts.paymentsEscrowAccounts.push(account)
    }
    for (const collected of page.graphTallyTokensCollecteds) {
      if (!collected.id || collected.id <= collectedCursor) {
        throw new Error('Collected tokens cursor did not advance')
      }
      collectedCursor = collected.id
      accounts.graphTallyTokensCollecteds.push(collected)
    }
    accountsDone ||= page.paymentsEscrowAccounts.length < pageSize
    collectedDone ||= page.graphTallyTokensCollecteds.length < pageSize
  }
  logger.trace('Payments escrow accounts', {
    indexer,
    collector: collectorAddress,
    block,
    accounts,
  })
  return PaymentsEscrowAccounts.fromResponse(logger, accounts)
}
