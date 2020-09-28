import graphqlHTTP from 'express-graphql'
import { makeExecutableSchema } from 'graphql-tools'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

export interface GraphQLServerOptions {
  indexerManagementClient: IndexerManagementClient
}

interface Context {
  client: IndexerManagementClient
}

interface CostModelsArgs {
  deployments: string[]
}

interface CostModelArgs {
  deployment: string
}

export const createCostServer = async ({
  indexerManagementClient,
}: GraphQLServerOptions): Promise<graphqlHTTP.Middleware> => {
  const executableSchema = makeExecutableSchema({
    typeDefs: gql`
      type CostModel {
        deployment: String!
        model: String
        variables: String
      }

      type Query {
        costModels(deployments: [String!]!): [CostModel!]!
        costModel(deployment: String!): CostModel
      }
    `,

    resolvers: {
      Query: {
        costModels: async (parent, args: CostModelsArgs, context: Context) => {
          if (!args.deployments) {
            throw new Error(
              `Argument "deployments" must be an array of subgraph deployment IDs`,
            )
          }

          const result = await context.client
            .query(
              gql`
                query costModels($deployments: [String!]) {
                  costModels(deployments: $deployments) {
                    deployment
                    model
                    variables
                  }
                }
              `,
              {
                deployments: args.deployments
                  ? args.deployments.map(s => new SubgraphDeploymentID(s).bytes32)
                  : null,
              },
            )
            .toPromise()

          if (result.error) {
            throw result.error
          }

          return result.data.costModels
        },

        costModel: async (parent, args: CostModelArgs, context: Context) => {
          const result = await context.client
            .query(
              gql`
                query costModel($deployment: [String!]) {
                  costModel(deployment: $deployment) {
                    deployment
                    model
                    variables
                  }
                }
              `,
              { deployment: new SubgraphDeploymentID(args.deployment).bytes32 },
            )
            .toPromise()

          if (result.error) {
            throw result.error
          }

          return result.data.costModel
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
