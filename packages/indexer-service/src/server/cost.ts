import { graphqlHTTP } from 'express-graphql'
import { Request, Response } from 'express'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import { Metrics, SubgraphDeploymentID } from '@tokene-q/common-ts'

export interface GraphQLServerOptions {
  indexerManagementClient: IndexerManagementClient
  metrics: Metrics
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
  metrics,
}: GraphQLServerOptions): Promise<
  (request: Request, response: Response) => Promise<void>
> => {
  const resolverMetrics = {
    costModelQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_queries_total',
      help: 'Queries for individual cost models',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    invalidCostModelQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_queries_invalid',
      help: 'Invalid queries for individual cost models',
      registers: [metrics.registry],
      labelNames: [],
    }),

    failedCostModelQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_queries_failed',
      help: 'Failed queries for individual cost models',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    costModelQueryDuration: new metrics.client.Histogram({
      name: 'indexer_service_cost_model_query_duration',
      help: 'Duration of processing queries for individual cost models',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    costModelBatchQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_batch_queries',
      help: 'Queries for batches of cost models',
      registers: [metrics.registry],
    }),

    invalidCostModelBatchQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_batch_queries_invalid',
      help: 'Invalid queries for batches of cost models',
      registers: [metrics.registry],
    }),

    failedCostModelBatchQueries: new metrics.client.Counter({
      name: 'indexer_service_cost_model_batch_queries_failed',
      help: 'Failed queries for batches of cost models',
      registers: [metrics.registry],
    }),

    costModelBatchQueryDuration: new metrics.client.Histogram({
      name: 'indexer_service_cost_model_batch_query_duration',
      help: 'Duration of processing batch queries for cost models',
      registers: [metrics.registry],
    }),

    costModelBatchQuerySize: new metrics.client.Histogram({
      name: 'indexer_service_cost_model_batch_query_size',
      help: 'Number of cost models requested per batch query',
      registers: [metrics.registry],
    }),
  }

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
          resolverMetrics.costModelBatchQueries.inc()

          if (!args.deployments) {
            resolverMetrics.invalidCostModelBatchQueries.inc()
            throw new Error(
              `Argument "deployments" must be an array of subgraph deployment IDs`,
            )
          }

          resolverMetrics.costModelBatchQuerySize.observe(args.deployments.length)

          const stopTimer = resolverMetrics.costModelBatchQueryDuration.startTimer()
          try {
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
          } catch (error) {
            resolverMetrics.failedCostModelBatchQueries.inc()
            throw error
          } finally {
            stopTimer()
          }
        },

        costModel: async (parent, args: CostModelArgs, context: Context) => {
          const deployment = new SubgraphDeploymentID(args.deployment).bytes32

          if (!deployment) {
            resolverMetrics.invalidCostModelQueries.inc()
            throw new Error(`Argument "deployment" must be a subgraph deployment ID`)
          }

          resolverMetrics.costModelQueries.inc({ deployment })

          const stopTimer = resolverMetrics.costModelQueryDuration.startTimer({
            deployment,
          })
          try {
            const result = await context.client
              .query(
                gql`
                  query costModel($deployment: String!) {
                    costModel(deployment: $deployment) {
                      deployment
                      model
                      variables
                    }
                  }
                `,
                { deployment },
              )
              .toPromise()

            if (result.error) {
              throw result.error
            }

            return result.data.costModel
          } catch (error) {
            resolverMetrics.failedCostModelQueries.inc({ deployment })
            throw error
          } finally {
            stopTimer()
          }
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
