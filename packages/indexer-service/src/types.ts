import { Attestation, Receipt, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Wallet } from 'ethers'

export interface QueryResult {
  graphQLResponse: string
  attestation: Attestation
}

export interface UnattestedQueryResult {
  graphQLResponse: string
  attestation: Receipt
}

export interface PaidQueryResponse {
  result: QueryResult
  status: number
  paymentAppState: string
}

export interface UnpaidQueryResponse {
  result: UnattestedQueryResult
  status: number
}

export interface PaidQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  paymentAppState: string
  query: string
  requestCID: string
}

export interface FreeQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  query: string
  requestCID: string
}

export interface QueryProcessor {
  executeFreeQuery(query: FreeQuery): Promise<UnpaidQueryResponse>
  executePaidQuery(query: PaidQuery): Promise<PaidQueryResponse>
}

export interface Allocation {
  id: string
  publicKey: string
  subgraphDeploymentID: SubgraphDeploymentID
  createdAtEpoch: number
}

export interface AllocationPaymentClient {
  allocation: Allocation
  wallet: Wallet
  unlockPayment(attestation: Attestation): Promise<string>
  settle(): Promise<void>
}

export interface PaymentManager {
  wallet: Wallet

  createStateChannels(allocations: Allocation[]): Promise<void>
  settleStateChannels(allocations: Allocation[]): Promise<void>
  stateChannel(paymentAppState: string): AllocationPaymentClient | undefined
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
