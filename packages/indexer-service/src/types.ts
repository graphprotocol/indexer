import EventEmitter from 'eventemitter3'
import { BigNumber } from 'ethers/utils'
import { attestations } from '@graphprotocol/common-ts'

export interface QueryResult {
  graphQLResponse: string
  attestation: attestations.Attestation
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
  privateKey: string

  unlockPayment(
    payment: ConditionalPayment,
    attestation: attestations.Attestation,
  ): Promise<void>
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

export class QueryError extends Error {
  status: number

  constructor(message: string, status?: number) {
    super(message)

    this.status = status || 500

    // Manually set the prototype, following the recommendation on
    // https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, QueryError.prototype)
  }
}
