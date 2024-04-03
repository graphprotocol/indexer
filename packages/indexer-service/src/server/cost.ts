import { graphqlHTTP } from 'express-graphql'
import { Request, Response } from 'express'
import { makeExecutableSchema } from '@graphql-tools/schema'
import gql from 'graphql-tag'
import { Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  IndexerManagementYogaClient,
  isAsyncIterable,
} from '@graphprotocol/indexer-common'
import { buildHTTPExecutor } from '@graphql-tools/executor-http'

export interface GraphQLServerOptions {
  indexerManagementClient: IndexerManagementYogaClient
  metrics: Metrics
}

interface Context {
  client: IndexerManagementYogaClient
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
          const executor = buildHTTPExecutor({
            fetch: context.client.yoga.fetch,
          })

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
            const result = await executor({
              document: gql`
                query costModels($deployments: [String!]) {
                  costModels(deployments: $deployments) {
                    deployment
                    model
                    variables
                  }
                }
              `,
              variables: {
                deployments: args.deployments
                  ? args.deployments.map(s => new SubgraphDeploymentID(s).bytes32)
                  : null,
              },
            })

            if (isAsyncIterable(result)) {
              throw new Error('Expected a single result, but got an async iterable')
            }

            if (result.errors) {
              throw result.errors
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
          const executor = buildHTTPExecutor({
            fetch: context.client.yoga.fetch,
          })

          if (!deployment) {
            resolverMetrics.invalidCostModelQueries.inc()
            throw new Error(`Argument "deployment" must be a subgraph deployment ID`)
          }

          resolverMetrics.costModelQueries.inc({ deployment })

          const stopTimer = resolverMetrics.costModelQueryDuration.startTimer({
            deployment,
          })
          try {
            const result = await executor({
              document: gql`
                query costModel($deployment: String!) {
                  costModel(deployment: $deployment) {
                    deployment
                    model
                    variables
                  }
                }
              `,
              variables: { deployment },
            })

            if (isAsyncIterable(result)) {
              throw new Error('Expected a single result, but got an async iterable')
            }

            if (result.errors) {
              throw result.errors
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
