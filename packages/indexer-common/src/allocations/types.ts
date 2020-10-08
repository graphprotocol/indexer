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
  publicKey: string
  subgraphDeployment: SubgraphDeployment
  createdAtEpoch: number
  allocatedTokens: BigNumber
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
  createdAtEpoch: allocation.createdAtEpoch,
  publicKey: allocation.publicKey,
})
