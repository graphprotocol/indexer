import { buildSchema, print } from 'graphql'
import gql from 'graphql-tag'
import { executeExchange } from '@urql/exchange-execute'
import { createClient, Client } from '@urql/core'
import { Logger, NetworkContracts } from '@graphprotocol/common-ts'

import { IndexerManagementModels, IndexingRuleCreationAttributes } from './models'

import indexingRuleResolvers from './resolvers/indexing-rules'
import statusResolvers from './resolvers/indexer-status'
import costModelResolvers from './resolvers/cost-models'
import { BigNumber } from 'ethers'

export interface IndexerManagementResolverContext {
  models: IndexerManagementModels
  address: string
  contracts: NetworkContracts
  logger?: Logger
  defaults: IndexerManagementDefaults
}

const SCHEMA_SDL = gql`
  scalar BigInt

  enum IndexingDecisionBasis {
    rules
    never
    always
  }

  type IndexingRule {
    deployment: String!
    allocationAmount: BigInt
    parallelAllocations: Int
    maxAllocationPercentage: Float
    minSignal: BigInt
    maxSignal: BigInt
    minStake: BigInt
    minAverageQueryFees: BigInt
    custom: String
    decisionBasis: IndexingDecisionBasis!
  }

  input IndexingRuleInput {
    deployment: String!
    allocationAmount: BigInt
    parallelAllocations: Int
    maxAllocationPercentage: Float
    minSignal: BigInt
    maxSignal: BigInt
    minStake: BigInt
    minAverageQueryFees: BigInt
    custom: String
    decisionBasis: IndexingDecisionBasis
  }

  type GeoLocation {
    latitude: String!
    longitude: String!
  }

  type IndexerRegistration {
    url: String
    address: String
    registered: Boolean!
    location: GeoLocation
  }

  type IndexerEndpointTest {
    test: String!
    error: String
    possibleActions: [String]!
  }

  type IndexerEndpoint {
    url: String
    healthy: Boolean!
    tests: [IndexerEndpointTest!]!
  }

  type IndexerEndpoints {
    service: IndexerEndpoint!
    status: IndexerEndpoint!
    channels: IndexerEndpoint!
  }

  type CostModel {
    deployment: String!
    model: String
    variables: String
  }

  input CostModelInput {
    deployment: String!
    model: String
    variables: String
  }

  type Query {
    indexingRule(deployment: String!, merged: Boolean! = false): IndexingRule
    indexingRules(merged: Boolean! = false): [IndexingRule!]!
    indexerRegistration: IndexerRegistration!
    indexerEndpoints: IndexerEndpoints!

    costModels(deployments: [String!]): [CostModel!]!
    costModel(deployment: String!): CostModel
  }

  type Mutation {
    setIndexingRule(rule: IndexingRuleInput!): IndexingRule!
    deleteIndexingRule(deployment: String!): Boolean!
    deleteIndexingRules(deployments: [String!]!): Boolean!

    setCostModel(costModel: CostModelInput!): CostModel!
  }
`

export interface IndexerManagementDefaults {
  globalIndexingRule: Omit<
    IndexingRuleCreationAttributes,
    'deployment' | 'allocationAmount'
  > & { allocationAmount: BigNumber }
}

export interface IndexerManagementClientOptions {
  models: IndexerManagementModels
  address: string
  contracts: NetworkContracts
  logger?: Logger
  defaults: IndexerManagementDefaults
}

export type IndexerManagementClient = Client

export const createIndexerManagementClient = async ({
  models,
  address,
  contracts,
  logger,
  defaults,
}: IndexerManagementClientOptions): Promise<Client> => {
  const schema = buildSchema(print(SCHEMA_SDL))
  const resolvers = {
    ...indexingRuleResolvers,
    ...statusResolvers,
    ...costModelResolvers,
  }

  const exchange = executeExchange({
    schema,
    rootValue: resolvers,
    context: {
      models,
      address,
      contracts,
      logger: logger ? logger.child({ component: 'IndexerManagementClient' }) : undefined,
      defaults,
    },
  })

  return createClient({ url: 'no-op', exchanges: [exchange] })
}
