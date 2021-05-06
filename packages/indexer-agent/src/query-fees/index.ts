import { Allocation } from '@graphprotocol/indexer-common'

export * from './transfers'

export interface ReceiptCollector {
  collectReceipts(allocation: Allocation): Promise<boolean>
}
