import { Address } from '@tokene-q/common-ts'
import { BigNumber } from 'ethers'

export * from './allocations'

export interface ReceiptManager {
  // Saves the query fees and returns the allocation for signing
  add(receiptData: string): Promise<{
    id: string
    allocation: Address
    fees: BigNumber
  }>
}
