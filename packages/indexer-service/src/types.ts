import { Attestation, Receipt, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Wallet } from 'ethers'
import { Response } from 'cross-fetch'
import {
  HexBytes32,
  Uint256,
  RawSignature,
  Brand,
  PaymentStore,
  Bytes32,
} from '@graphprotocol/common-ts'

export interface QueryResult {
  graphQLResponse: string
  attestation: Attestation
}

export interface UnattestedQueryResult {
  graphQLResponse: string
  attestation: Receipt
}

export type Response<T> = {
  result: T
  status: number
}

export type PaidQueryResponse = Response<QueryResult>

export type FreeQueryResponse = Response<UnattestedQueryResult>

export interface PaymentAppState {
  paymentId: HexBytes32
  totalPayment: Uint256
  signature: RawSignature
  amount: Uint256
}

/**
 * A PaymentAppState which has been parsed but not validated. For example,
 * all the data types are parsed but basic invariants like that totalPayment > amount,
 * or that the signature is not just 0x0000..., or that the payment belongs to a valid
 * channel, etc etc are not validated.
 */
export type UnvalidatedPaymentAppState = Brand<
  PaymentAppState,
  'UnvalidatedPaymentAppState'
>

export interface PaidQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  paymentAppState: PaymentAppState
  query: string
  // TODO: (Zac) Does this need to be here?
  requestCID: string
}

export interface FreeQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  query: string
  // TODO: (Zac) Does this need to be here?
  requestCID: string
}

export interface QueryProcessor {
  executeFreeQuery(query: FreeQuery): Promise<FreeQueryResponse>
  executePaidQuery(query: PaidQuery): Promise<PaidQueryResponse>
}

// TODO: (Zac) Is this.id the same as the appHash?
export interface Allocation {
  id: string
  publicKey: string
  subgraphDeploymentID: SubgraphDeploymentID
  createdAtEpoch: number
}

export interface StateChannel {
  info: Allocation
  wallet: Wallet
  settle(): Promise<void>
}

export interface PaymentManager {
  wallet: Wallet

  createStateChannels(channels: Allocation[]): Promise<void>
  settleStateChannels(channels: Allocation[]): Promise<void>

  /**
   * Attempts to hold a payment during the execution of a query.
   *
   * If this method returns without throwing, a call to
   * savePayment or dropPayment must be made at some point in the future.
   *
   * @throws If payment is invalid
   * @throws If payment does not account for the cost of the query
   * @throws If a connection to the database could not be maintained
   *
   * @returns The address of the wallet to sign with
   */
  lockPayment(payment: PaymentAppState): Promise<Wallet>

  /**
   * Save a payment so that when the stateChannel is settled it's associated
   * funds will be unlocked.
   */
  savePayment(payment: PaymentAppState, attestation: Attestation): Promise<void>

  /**
   * Release the hold on a payment that will not be collected. For example,
   * if the query is rejected because
   */
  dropPayment(payment: PaymentAppState): Promise<void>
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

export function withContext<TOut>(
  message: string,
  op: () => TOut,
  status?: number,
): TOut {
  try {
    return op()
  } catch (error) {
    throw new QueryError(`${error.message}.\nContext: ${message}`, error.status ?? status)
  }
}

const HEX = /^[0-9a-f]+$/

/**
 * WARN: CWE-20: Improper Input Validation
 */
function validateHex(value: unknown, bytes: number) {
  if (typeof value !== 'string') {
    return false
  }

  if (value.length !== 2 + bytes * 2) {
    return false
  }

  // 0x Prefix
  if (value.charAt(0) !== '0' || value.charAt(1) !== 'x') {
    return false
  }

  return HEX.test(value.substring(2))
}

/**
 * WARN: CWE-20: Improper Input Validation
 */
export function validateHexBytes32(value: unknown): value is HexBytes32 {
  return validateHex(value, 32)
}

/**
 * WARN: CWE-20: Improper Input Validation
 */
export function validateSignature(value: unknown): value is RawSignature {
  return validateHex(value, 65)
}

/**
 * Remove the 0x prefix from a valid HexBytes32
 * */
export function stripHexBytes32Prefix(value: HexBytes32): Bytes32 {
  return value.substring(2) as Bytes32
}

const Uint256MIN = BigInt(0) as Uint256
const Uint256MAX = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
) as Uint256

/**
 * @throws if the value was not convertible to bigint
 */
export function coerceToBigInt(value: unknown): bigint {
  if (typeof value !== 'bigint') {
    value = BigInt(value)
  }
  return value as bigint
}

/**
 * Converts a type to Uint256 if possible
 *
 * WARN: CWE-20: Improper Input Validation
 */
export function parseUint256(value: unknown): Uint256 {
  const bigInt = coerceToBigInt(value)

  if (Uint256MIN > bigInt || bigInt > Uint256MAX) {
    throw new QueryError('uint256 out of range')
  }

  return bigInt as Uint256
}
