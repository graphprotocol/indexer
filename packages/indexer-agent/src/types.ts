import { logging } from '@graphprotocol/common-ts'

export interface AgentConfig {
  mnemonic: string
  statusEndpoint: string
  adminEndpoint: string
  queryEndpoint: string
  publicIndexerUrl: string
  indexerGeoCoordinates: [string, string]
  ethereumProvider: string
  network: string
  logger: logging.Logger
  networkSubgraphDeployment: string
}

export interface SubgraphKey {
  name: string
  owner: string
  subgraphId: string
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
  defaultName: GraphName
}

export interface NetworkSubgraph {
  id: string
  name: string
  owner?: GraphAccount
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

export interface NetworkAddresses {
  ropsten: ContractAddresses
  kovan: ContractAddresses
  mainnet: ContractAddresses
  ganache: ContractAddresses
}
