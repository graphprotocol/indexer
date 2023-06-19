import { Address } from '@tokene-q/common-ts'
import { BigNumber } from 'ethers'
import { SubgraphDeployment } from '@graphprotocol/indexer-common'

export interface Allocation {
  id: Address
  status: AllocationStatus
  subgraphDeployment: SubgraphDeployment
  indexer: Address
  allocatedTokens: BigNumber
  createdAtEpoch: number
  createdAtBlockHash: string
  closedAtEpoch: number
  closedAtEpochStartBlockHash: string | undefined
  previousEpochStartBlockHash: string | undefined
  closedAtBlockHash: string
  poi: string | undefined
  queryFeeRebates: BigNumber | undefined
  queryFeesCollected: BigNumber | undefined
}

export enum AllocationStatus {
  NULL = 'Null',
  ACTIVE = 'Active',
  CLOSED = 'Closed',
  FINALIZED = 'Finalized',
  CLAIMED = 'Claimed',
}
