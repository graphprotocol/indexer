import { logging } from '@graphprotocol/common-ts'

export interface AgentConfig {
  mnemonic: string
  statusEndpoint: string
  adminEndpoint: string
  publicIndexerUrl: string
  ethereumProvider: string
  network: string
  logger: logging.Logger
}

export interface SubgraphKey {
  name: string
  subgraphId: string
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
