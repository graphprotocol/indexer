import { Allocation } from '@graphprotocol/indexer-common'

export * from './transfers'
export * from './allocations'
export * from './allocation-exchange'

export interface ReceiptCollector {
  collectReceipts(allocation: Allocation): Promise<boolean>
}
