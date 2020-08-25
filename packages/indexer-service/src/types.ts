/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Message as WireMessage } from '@statechannels/client-api-schema'
import { Attestation, Receipt, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Wallet, utils } from 'ethers'

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
  envelopedAttestation: string
}

export interface UnpaidQueryResponse {
  result: UnattestedQueryResult
  status: number
}

export interface PaidQuery {
  allocationID: string
  subgraphDeploymentID: SubgraphDeploymentID
  stateChannelMessage: WireMessage
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

export type Address = string & { _isAddress: void }

export const toAddress = (s: string): Address => utils.getAddress(s) as Address

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeAllocation = (allocation: any): Allocation => {
  // Ensure the allocation ID (an address) is checksummed
  allocation.id = toAddress(allocation.id)
  return allocation
}

export interface Allocation {
  id: Address
  publicKey: string
  subgraphDeploymentID: SubgraphDeploymentID
  createdAtEpoch: number
}

export interface AllocationPaymentClient {
  allocation: Allocation
  wallet: Wallet
  handleMessage(message: WireMessage): Promise<WireMessage | undefined>
  validatePayment(query: PaidQuery): Promise<string>
  provideAttestation(
    channelId: string,
    query: PaidQuery,
    attestation: Attestation,
  ): Promise<WireMessage>
  declineQuery(channelId: string, query: PaidQuery): Promise<WireMessage>
  settle(): Promise<void>
}

export interface PaymentManager {
  wallet: Wallet

  createAllocationPaymentClients(allocations: Allocation[]): void
  collectAllocationPayments(allocations: Allocation[]): Promise<void>
  getAllocationPaymentClient(allocationId: string): AllocationPaymentClient | undefined
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
