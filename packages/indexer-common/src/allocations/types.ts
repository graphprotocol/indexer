import { BigNumber } from 'ethers'
import { NetworkSubgraph, SubgraphDeployment } from '@graphprotocol/indexer-common'

import { Logger, Address } from '@graphprotocol/common-ts'

export interface Allocation {
  id: Address
  status: AllocationStatus
  subgraphDeployment: SubgraphDeployment
  indexer: Address
  indexingRewards?: BigNumber
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

export interface MonitorEligibleAllocationsOptions {
  indexer: Address
  logger: Logger
  networkSubgraph: NetworkSubgraph
  interval: number
  protocolNetwork: string
}
