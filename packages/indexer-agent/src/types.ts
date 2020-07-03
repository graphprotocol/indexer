import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'

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
}

export interface SubgraphDeploymentKey {
  owner: string
  subgraphDeploymentID: SubgraphDeploymentID
}

interface SubgraphDeployment {
  id: string
  totalStake: number
}

interface SubgraphVersion {
  id: string
  unpublished: boolean
  subgraphDeployment: SubgraphDeployment
}

interface GraphName {
  id: string
  nameSystem: string
  name: string
}

interface GraphAccount {
  id: string
}

export interface Subgraph {
  id: string
  owner: GraphAccount
  totalNameSignaledGRT: number
  totalNameSignalMinted: number
  currentVersion: SubgraphVersion
}

interface ContractAddresses {
  GNS: string
  GraphToken: string
  MultisigWallet: string
  ServiceRegistry: string
  Staking: string
  EpochManager: string
}
