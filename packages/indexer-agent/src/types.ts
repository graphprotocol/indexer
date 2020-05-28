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
}

export interface SubgraphKey {
  name: string
  owner: string
  subgraphId: string
}
interface SubgraphOwner {
  id: string
  name: string
  balance: number
}

interface NamedSubgraph {
  id: string
  name: string
  nameSystem: string
  owner: SubgraphOwner
}

interface SubgraphVersion {
  id: string
  version: number
  displayName: string
  description: string
  networks: string[]
  namedSubgraph: NamedSubgraph
}

export interface SubgraphStake {
  id: string
  totalStake: number
  versions: SubgraphVersion[]
}

interface ContractAddresses {
  GNS: string
  GraphToken: string
  MultisigWallet: string
  ServiceRegistry: string
  Staking: string
}

export interface NetworkAddresses {
  ropsten: ContractAddresses
  kovan: ContractAddresses
  mainnet: ContractAddresses
  ganache: ContractAddresses
}
