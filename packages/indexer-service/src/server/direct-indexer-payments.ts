import { graphqlHTTP } from 'express-graphql'
import { Request, Response } from 'express'
import { makeExecutableSchema } from 'graphql-tools'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import { Metrics } from '@graphprotocol/common-ts'

interface DirectIndexerPaymentsServerOptions {
  indexerManagementClient: IndexerManagementClient
  metrics: Metrics
}

interface Context {
  client: IndexerManagementClient
}

interface CreateAgreementArgs {
  signature: string
  data: string
}

export const createDirectIndexerPaymentsServer = async ({
  indexerManagementClient,
  metrics,
}: DirectIndexerPaymentsServerOptions): Promise<
  (request: Request, response: Response) => Promise<void>
> => {
  const resolverMetrics = {
    indexingAgreementCreationDuration: new metrics.client.Histogram({
      name: 'indexer_service_indexing_agreement_creation_duration',
      help: 'Duration of indexing agreement creation',
      registers: [metrics.registry],
      labelNames: [],
    }),
    indexingAgreementCreated: new metrics.client.Counter({
      name: 'indexer_service_indexing_agreements_created',
      help: 'Indexing agreements created',
      registers: [metrics.registry],
      labelNames: [],
    }),
    indexingPricesQueries: new metrics.client.Counter({
      name: 'indexer_service_indexing_prices_queried',
      help: 'Indexing prices queried',
      registers: [metrics.registry],
      labelNames: [],
    }),
  }

  const executableSchema = makeExecutableSchema({
    typeDefs: gql`
      type IndexingAgreement {
        signature: String!
        data: String!
      }

      type IndexingPrice {
        subgraphDeploymentID: String!
        price: BigInt!
      }

      type Query {
        agreement(signature: String!): IndexingAgreement
        price(subgraphDeploymentID: String!): IndexingPrice
      }

      type Mutation {
        createIndexingAgreement(signature: String!, data: String!): IndexingAgreement
      }
    `,
    resolvers: {
      Query: {
        price: async (parent, { subgraphDeploymentID }, context: Context) => {
          resolverMetrics.indexingPricesQueries.inc({
            subgraph_deployment_id: subgraphDeploymentID,
          })
          return context.client.query(gql`
            query {
              price(subgraphDeploymentID: "${subgraphDeploymentID}") {
                subgraphDeploymentID
                pricePerBlock
              }
            }
         `)
        },
        agreement: async (parent, { signature }, context: Context) => {
          resolverMetrics.indexingAgreementCreated.inc()
          return context.client.query(gql`
            query {
              agreement(signature: "${signature}") {
                signature
                data
              }
            }
          `)
        },
      },
      Mutation: {
        // Prices are created from the cli, and indicate participation in indexing-payments on the part of the indexer
        // Therefore no hypothetical 'createIndexingPrice' mutation is needed or desirable.
        createIndexingAgreement: async (
          parent,
          args: CreateAgreementArgs,
          context: Context,
        ) => {
          resolverMetrics.indexingAgreementCreated.inc()
          return context.client.mutation(gql`
            mutation {
              createIndexingAgreement(signature: "${args.signature}", data: "${args.data}") {
                signature
                data
              }
          `)
        },
      },
    },
  })

  return graphqlHTTP({
    schema: executableSchema,
    graphiql: false,
    context: { client: indexerManagementClient },
  })
}
