import { Attestation, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Wallet, BigNumberish } from 'ethers'
import { Evt } from 'evt'

export interface QueryResult {
  graphQLResponse: string
  attestation: Attestation
}

export interface QueryResponse {
  result: QueryResult
  status: number
}

export interface PaidQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  paymentId: string
  query: string
  requestCID: string
}

export interface FreeQuery {
  subgraphDeploymentID: SubgraphDeploymentID
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
  amount: BigNumberish
  sender: string
  signer: string
}

export interface ConditionalSubgraphPayment {
  payment: ConditionalPayment
  stateChannelID: string
  subgraphDeploymentID: SubgraphDeploymentID
}

export interface Allocation {
  id: string
  publicKey: string
  subgraphDeploymentID: SubgraphDeploymentID
  createdAtEpoch: number
}

export interface StateChannelEvents {
  paymentReceived: Evt<ConditionalPayment>
}

export interface StateChannel {
  allocation: Allocation
  wallet: Wallet

  events: StateChannelEvents

  unlockPayment(payment: ConditionalPayment, attestation: Attestation): Promise<void>
  cancelPayment(payment: ConditionalPayment): Promise<void>
  settle(): Promise<void>
}

export interface PaymentReceivedEvent {
  payment: ConditionalPayment
  stateChannel: StateChannel
}

export interface PaymentManagerEvents {
  paymentReceived: Evt<PaymentReceivedEvent>
}

export interface PaymentManager {
  wallet: Wallet
  events: PaymentManagerEvents

  createStateChannels(allocations: Allocation[]): Promise<void>
  settleStateChannels(allocations: Allocation[]): Promise<void>
  stateChannel(id: string): StateChannel | undefined
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
