import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'

export interface AgentConfig {
  mnemonic: string
  statusEndpoint: string
  adminEndpoint: string
  queryEndpoint: string
  rulesEndpoint: string
  publicIndexerUrl: string
  indexerGeoCoordinates: [string, string]
  ethereumProvider: string
  logger: Logger
  networkSubgraphDeployment: SubgraphDeploymentID
  connextNode: string
  indexNodeIDs: string[]
}

interface SubgraphDeployment {
  id: SubgraphDeploymentID
  stakedTokens: BigNumber
  signalAmount: BigNumber
}

export interface Allocation {
  id: string
  subgraphDeployment: SubgraphDeployment
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

enum IndexingDecisionBasis {
  rules = 'RULES',
  never = 'NEVER',
  always = 'ALWAYS',
}

//TODO: import this interface from common-ts?
export interface IndexingRules {
  deployment: string
  allocation: BigNumber | null
  maxAllocationPercentage: number | null
  minSignal: BigNumber | null
  maxSignal: BigNumber | null
  minStake: BigNumber | null
  minAverageQueryFees: BigNumber | null
  custom: string | null
  decisionBasis: IndexingDecisionBasis
}
