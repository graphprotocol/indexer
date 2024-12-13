import { Address, toAddress } from '@graphprotocol/common-ts'
import { SubgraphClient } from '../subgraph-client'
import gql from 'graphql-tag'

type U256 = bigint

export type EscrowAccountResponse = {
  escrowAccounts: {
    balance: string
    sender: {
      id: string
    }
  }[]
}

export class EscrowAccounts {
  constructor(private sendersBalances: Map<Address, U256>) {}

  getBalanceForSender(sender: Address): U256 {
    const balance = this.sendersBalances.get(sender)
    if (balance === undefined) {
      throw new Error(`No balance found for sender: ${sender}`)
    }
    return balance
  }

  subtractSenderBalance(sender: Address, ravValue: U256) {
    const balance = this.getBalanceForSender(sender)
    if (balance < ravValue) {
      throw new Error(`Negative balances are not allowed`)
    }
    const newBalance = balance - ravValue
    this.sendersBalances.set(sender, newBalance)
  }

  static fromResponse(response: EscrowAccountResponse): EscrowAccounts {
    const sendersBalances = new Map<Address, U256>()
    response.escrowAccounts.forEach((account) => {
      sendersBalances.set(toAddress(account.sender.id), BigInt(account.balance))
    })

    return new EscrowAccounts(sendersBalances)
  }
}

export const getEscrowAccounts = async (
  tapSubgraph: SubgraphClient,
  indexer: Address,
): Promise<EscrowAccounts> => {
  const result = await tapSubgraph.query<EscrowAccountResponse>(
    gql`
      query EscrowAccountQuery($indexer: ID!) {
        escrowAccounts(where: { receiver_: { id: $indexer } }) {
          balance
          sender {
            id
          }
        }
      }
    `,
    { indexer },
  )
  if (!result.data) {
    throw `There was an error while querying Tap Subgraph. Errors: ${result.error}`
  }
  return EscrowAccounts.fromResponse(result.data)
}
