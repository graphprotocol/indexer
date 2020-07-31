import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

export interface AgentConfig {
  mnemonic: string
  statusEndpoint: string
  adminEndpoint: string
  queryEndpoint: string
  publicIndexerUrl: string
  indexerGeoCoordinates: [string, string]
  ethereumProvider: string
  network: string
  logger: Logger
  networkSubgraphDeployment: SubgraphDeploymentID
  connextNode: string
  indexNodeIDs: string[]
}

interface SubgraphDeployment {
  id: string
  totalStake: BigNumber
}

export interface Allocation {
  id: string
  subgraphDeployment: SubgraphDeploymentID
  allocatedTokens: BigNumber
  createdAtEpoch: number
}
