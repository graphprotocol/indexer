/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Address, SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

export interface SubgraphDeployment {
  id: SubgraphDeploymentID
  stakedTokens: BigNumber
  signalAmount: BigNumber
}

export interface Allocation {
  id: Address
  subgraphDeployment: SubgraphDeployment
  createdAtEpoch: number
  createdAtBlockHash: string
  closedAtEpoch: number
  allocatedTokens: BigNumber
}

export enum AllocationStatus {
  Null,
  Active,
  Closed,
  Finalized,
  Claimed,
}

export const parseGraphQLAllocation = (allocation: any): Allocation => ({
  // Ensure the allocation ID (an address) is checksummed
  id: toAddress(allocation.id),
  subgraphDeployment: {
    id: new SubgraphDeploymentID(allocation.subgraphDeployment.id),
    stakedTokens: BigNumber.from(allocation.subgraphDeployment.stakedTokens),
    signalAmount: BigNumber.from(allocation.subgraphDeployment.signalAmount),
  },
  allocatedTokens: BigNumber.from(allocation.allocatedTokens),
  createdAtBlockHash: allocation.createdAtBlockHash,
  createdAtEpoch: allocation.createdAtEpoch,
  closedAtEpoch: allocation.closedAtEpoch,
})
