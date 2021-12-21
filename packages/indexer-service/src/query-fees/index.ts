import { Address } from '@graphprotocol/common-ts'

export * from './allocations'

export interface ReceiptManager {
  // Saves the query fees and returns the allocation for signing
  add(receiptData: string): Promise<Address>
}
