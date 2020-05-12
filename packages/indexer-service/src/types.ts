import EventEmitter from 'eventemitter3'
import { BigNumber } from 'ethers/utils'

export interface QueryResult {
  subgraphId: string
  requestCID: string
  responseCID: string
  attestation: string
  graphQLResponse: string
}

export interface QueryResponse {
  result: QueryResult
  status: number
}

export interface PaidQuery {
  subgraphId: string
  paymentId: string
  query: string
  requestCID: string
}

export interface FreeQuery {
  subgraphId: string
  query: string
  requestCID: string
}

export interface QueryProcessor {
  addFreeQuery(query: FreeQuery): Promise<QueryResponse>
  addPaidQuery(query: PaidQuery): Promise<QueryResponse>
  addPayment(stateChannel: StateChannel, payment: ConditionalPayment): Promise<void>
}

export interface ConditionalPayment {
  paymentId: string
  appIdentityHash: string
  amount: BigNumber
  sender: string
  signer: string
}

export interface ConditionalSubgraphPayment {
  payment: ConditionalPayment
  subgraphId: string
}

export interface StateChannelEventTypes {
  'payment-received': ConditionalPayment
}

export type StateChannelEventNames = 'payment-received'

export interface StateChannel extends EventEmitter<StateChannelEventNames> {
  subgraph: string

  unlockPayment(payment: ConditionalPayment, attestation: string): Promise<void>
  cancelPayment(payment: ConditionalPayment): Promise<void>
  settle(): Promise<void>
}

export interface PaymentManagerEventTypes {
  'payment-received': { payment: ConditionalPayment; stateChannel: StateChannel }
}

export type PaymentManagerEventNames = 'payment-received'

export interface PaymentManager extends EventEmitter<PaymentManagerEventNames> {
  createStateChannelsForSubgraphs(subgraphs: string[]): Promise<void>
  settleStateChannelsForSubgraphs(subgraphs: string[]): Promise<void>
  stateChannelForSubgraph(subgraph: string): StateChannel | undefined
}
