import { Allocation } from '@graphprotocol/indexer-common'

export * from './allocations'

export interface ReceiptCollector {
  rememberAllocations(allocations: Allocation[]): Promise<boolean>
  collectReceipts(allocation: Allocation): Promise<boolean>
}
