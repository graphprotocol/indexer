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

export interface IndexingStatus {
  subgraphDeployment: SubgraphDeploymentID
  health: string
  synced: boolean
  fatalError: IndexingError
}

export interface IndexingError {
  handler: string
  message: string
}
