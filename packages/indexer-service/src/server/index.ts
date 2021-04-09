import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { QueryProcessor } from '../types'
import { createStatusServer } from './status'
import {
  Logger,
  Metrics,
  SubgraphDeploymentID,
  secureExpressApp,
} from '@graphprotocol/common-ts'
import {
  indexerError,
  IndexerErrorCode,
  IndexerManagementClient,
} from '@graphprotocol/indexer-common'
import { createCostServer } from './cost'
import { createOperatorServer } from './operator'

export interface ServerOptions {
  logger: Logger
  metrics: Metrics
  port?: number
  queryProcessor: QueryProcessor
  freeQueryAuthToken: string | undefined
  graphNodeStatusEndpoint: string
  indexerManagementClient: IndexerManagementClient
  release: {
    version: string
    dependencies: { [key: string]: string }
  }
  operatorPublicKey: string
}

export const createApp = async ({
  logger,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
  indexerManagementClient,
  metrics,
  release,
  operatorPublicKey,
}: ServerOptions): Promise<express.Express> => {
  // Install metrics for incoming queries
  const serverMetrics = {
    queries: new metrics.client.Counter({
      name: 'indexer_service_queries_total',
      help: 'Incoming queries',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    successfulQueries: new metrics.client.Counter({
      name: 'indexer_service_queries_ok',
      help: 'Successfully executed queries',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    failedQueries: new metrics.client.Counter({
      name: 'indexer_service_queries_failed',
      help: 'Queries that failed to execute',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queriesWithInvalidPaymentHeader: new metrics.client.Counter({
      name: 'indexer_service_queries_with_invalid_payment_header',
      help:
        'Queries that failed executing because they came with an invalid payment header',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queriesWithInvalidPaymentValue: new metrics.client.Counter({
      name: 'indexer_service_queries_with_invalid_payment_value',
      help:
        'Queries that failed executing because they came with an invalid payment value',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queriesWithoutPayment: new metrics.client.Counter({
      name: 'indexer_service_queries_without_payment',
      help: 'Queries that failed executing because they came without a payment',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queryDuration: new metrics.client.Histogram({
      name: 'indexer_service_query_duration',
      help: 'Duration of processing a query from start to end',
      labelNames: ['name', 'deployment'],
      registers: [metrics.registry],
    }),

    channelMessages: new metrics.client.Counter({
      name: 'indexer_service_channel_messages_total',
      help: 'Incoming channel messages',
      registers: [metrics.registry],
      labelNames: [],
    }),

    successfulChannelMessages: new metrics.client.Counter({
      name: 'indexer_service_channel_messages_ok',
      help: 'Successfully handled channel messages',
      registers: [metrics.registry],
      labelNames: [],
    }),

    failedChannelMessages: new metrics.client.Counter({
      name: 'indexer_service_channel_messages_failed',
      help: 'Failed channel messages',
      registers: [metrics.registry],
      labelNames: [],
    }),

    channelMessageDuration: new metrics.client.Histogram({
      name: 'indexer_service_channel_message_duration',
      help: 'Duration of processing channel messages',
      registers: [metrics.registry],
      labelNames: [],
    }),
  }

  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const app = express()

  // Log requests to the logger stream
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(morgan('tiny', { stream: loggerStream }) as any)
  app.use(cors())

  // Security
  secureExpressApp(app)

  // Endpoint for health checks
  app.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // Endpoint for version
  app.use('/version', (_, res) => {
    res.status(200).send({ ...release })
  })

  // Endpoint for the public status API
  app.use(
    '/status',
    bodyParser.json(),
    await createStatusServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for the public cost API
  app.use(
    '/cost',
    bodyParser.json(),
    await createCostServer({ indexerManagementClient, metrics }),
  )

  // Endpoint for operator information
  app.use(
    '/operator',
    bodyParser.json(),
    await createOperatorServer({ operatorPublicKey }),
  )

  let freeQueryAuthValue: string | undefined
  if (freeQueryAuthToken) {
    freeQueryAuthValue = `Bearer ${freeQueryAuthToken}`
  }

  // Endpoint for subgraph queries
  app.post(
    '/subgraphs/id/:id',

    // Accept JSON but don't parse it
    bodyParser.raw({ type: 'application/json' }),

    async (req, res) => {
      const { id } = req.params
      const query = req.body.toString()

      const subgraphDeploymentID = new SubgraphDeploymentID(id)

      const stopQueryTimer = serverMetrics.queryDuration.startTimer({
        deployment: subgraphDeploymentID.ipfsHash,
      })
      serverMetrics.queries.inc({ deployment: subgraphDeploymentID.ipfsHash })

      try {
        // Extract the payment
        const payment = req.headers['x-graph-payment']
        if (payment !== undefined && typeof payment !== 'string') {
          logger.info(`Query has invalid payment`, {
            deployment: subgraphDeploymentID.display,
            payment,
          })
          serverMetrics.queriesWithInvalidPaymentHeader.inc({
            deployment: subgraphDeploymentID.ipfsHash,
          })
          const err = indexerError(IndexerErrorCode.IE029)
          return res
            .status(402)
            .contentType('application/json')
            .send({ error: err.message })
        }

        // Trusted indexer scenario: if the sender provides the free
        // query auth token, we do not require payment
        let paymentRequired = true
        if (freeQueryAuthValue && req.headers['authorization'] === freeQueryAuthValue) {
          paymentRequired = false
        }

        if (paymentRequired) {
          // Regular scenario: a payment is required; fail if no
          // state channel is specified
          if (payment === undefined) {
            logger.info(`Query is missing signed state`, {
              deployment: subgraphDeploymentID.display,
            })
            serverMetrics.queriesWithoutPayment.inc({
              deployment: subgraphDeploymentID.ipfsHash,
            })
            const err = indexerError(IndexerErrorCode.IE030)
            return res
              .status(402)
              .contentType('application/json')
              .send({ error: err.message })
          }

          logger.info(`Received paid query`, {
            deployment: subgraphDeploymentID.display,
            receipt: payment,
          })

          try {
            const response = await queryProcessor.executePaidQuery({
              subgraphDeploymentID,
              payment,
              query,
            })
            serverMetrics.successfulQueries.inc({
              deployment: subgraphDeploymentID.ipfsHash,
            })
            res
              .status(response.status || 200)
              .contentType('application/json')
              .send(response.result)
          } catch (error) {
            const err = indexerError(IndexerErrorCode.IE032, error)
            logger.error(`Failed to handle paid query`, { err })
            serverMetrics.failedQueries.inc({ deployment: subgraphDeploymentID.ipfsHash })
            res = res.status(error.status || 500).contentType('application/json')
            res.send({ error: `${err.message}` })
          }
        } else {
          logger.info(`Received free query`, { deployment: subgraphDeploymentID.display })

          try {
            const response = await queryProcessor.executeFreeQuery({
              subgraphDeploymentID,
              query,
            })
            res
              .status(response.status || 200)
              .contentType('application/json')
              .send(response.result)
          } catch (error) {
            const err = indexerError(IndexerErrorCode.IE033, error)
            logger.error(`Failed to handle free query`, { err })
            res
              .status(error.status || 500)
              .contentType('application/json')
              .send({ error: `${err.message}` })
          }
        }
      } finally {
        stopQueryTimer()
      }
    },
  )

  return app
}

export const createServer = async ({
  logger,
  port,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
  indexerManagementClient,
  metrics,
  release,
  operatorPublicKey,
}: ServerOptions): Promise<express.Express> => {
  const app = await createApp({
    logger,
    queryProcessor,
    freeQueryAuthToken,
    graphNodeStatusEndpoint,
    indexerManagementClient,
    metrics,
    release,
    operatorPublicKey,
  })

  app.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return app
}
