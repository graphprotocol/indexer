import { EventEmitter } from 'events'
import { BigNumber } from 'ethers/utils'

export interface QueryResult {
  requestCid: string
  responseCid: string
  attestation: string
  graphQLResponse: string
}

export interface PaidQueryResponse {
  result: QueryResult
  status: number
}

export interface PaidQuery {
  subgraphId: string
  paymentId: string
  query: string
}

export interface FreeQuery {
  subgraphId: string
  query: string
}

export interface FreeQueryResponse {
  subgraphId: string
  status: number
  data: any
}

export interface PaidQueryProcessor {
  addPaidQuery(query: PaidQuery): Promise<PaidQueryResponse>
  addPayment(payment: ConditionalPayment): Promise<void>
}

export interface FreeQueryProcessor {
  addFreeQuery(query: FreeQuery): Promise<FreeQueryResponse>
}

export interface ConditionalPayment {
  paymentId: string
  amount: BigNumber
  sender: string
  signer: string
}

export interface ConditionalPaymentUnlockInfo {
  paymentId: string
  amount: BigNumber
  attestation: string
}

export interface PaymentManager extends EventEmitter {
  unlockPayment(info: ConditionalPaymentUnlockInfo): Promise<void>
  cancelPayment(paymentId: string): Promise<void>
}
