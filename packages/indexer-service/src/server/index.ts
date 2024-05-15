import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { QueryProcessor } from '../types'
import { createStatusServer } from './status'
import { createDeploymentHealthServer } from './deployment-health'
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
  NetworkSubgraph,
} from '@graphprotocol/indexer-common'
import { createCostServer } from './cost'
import { createOperatorServer } from './operator'
import rateLimit from 'express-rate-limit'
import http from 'http'

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
  networkSubgraph: NetworkSubgraph
  networkSubgraphAuthToken: string | undefined
  serveNetworkSubgraph: boolean
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
  networkSubgraph,
  networkSubgraphAuthToken,
  serveNetworkSubgraph,
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

    queriesWithInvalidReceiptHeader: new metrics.client.Counter({
      name: 'indexer_service_queries_with_invalid_receipt_header',
      help: 'Queries that failed executing because they came with an invalid receipt header',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queriesWithInvalidReceiptValue: new metrics.client.Counter({
      name: 'indexer_service_queries_with_invalid_receipt_value',
      help: 'Queries that failed executing because they came with an invalid receipt value',
      registers: [metrics.registry],
      labelNames: ['deployment'],
    }),

    queriesWithoutReceipt: new metrics.client.Counter({
      name: 'indexer_service_queries_without_receipt',
      help: 'Queries that failed executing because they came without a receipt',
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

  // Limit status requests to 9000/30min (5/s)
  const slowLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 1 minutes
    max: 9000,
  })

  // Limit network requests to 90000/30min (50/s)
  const networkLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 1 minutes
    max: 90000,
  })

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
    networkLimiter,
    bodyParser.json(),
    await createStatusServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for subgraph health checks
  app.use(
    '/subgraphs/health',
    slowLimiter,
    createDeploymentHealthServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for the public cost API
  app.use(
    '/cost',
    slowLimiter,
    bodyParser.json(),
    await createCostServer({ indexerManagementClient, metrics }),
  )

  // Endpoint for operator information
  app.use(
    '/operator',
    slowLimiter,
    bodyParser.json(),
    await createOperatorServer({ operatorPublicKey }),
  )

  let freeQueryAuthValue: string | undefined
  if (freeQueryAuthToken) {
    freeQueryAuthValue = `Bearer ${freeQueryAuthToken}`
  }

  if (serveNetworkSubgraph) {
    // Endpoint for network subgraph queries
    app.post(
      `/network`,
      networkLimiter,
      bodyParser.raw({ type: 'application/json' }),
      async (req, res) => {
        try {
          logger.info(`Handle network subgraph query`)

          let networkSubgraphAuthValue: string | undefined
          if (networkSubgraphAuthToken) {
            networkSubgraphAuthValue = `Bearer ${networkSubgraphAuthToken}`
          }

          if (
            networkSubgraphAuthValue &&
            req.headers['authorization'] !== networkSubgraphAuthValue
          ) {
            throw new Error(`Invalid auth token`)
          }

          const result = await networkSubgraph.queryRaw(req.body)
          res.status(200).contentType('application/json').send(result.data)
        } catch (err) {
          logger.warn(`Failed to handle network subgraph query`, { err })
          return res.status(200).send({ errors: [{ message: err.message }] })
        }
      },
    )
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
        // Extract the receipt
        const receipt = req.headers['scalar-receipt']
        if (receipt !== undefined && typeof receipt !== 'string') {
          logger.info(`Query has invalid receipt`, {
            deployment: subgraphDeploymentID.display,
            receipt,
          })
          serverMetrics.queriesWithInvalidReceiptHeader.inc({
            deployment: subgraphDeploymentID.ipfsHash,
          })
          const err = indexerError(IndexerErrorCode.IE029)
          return res
            .status(402)
            .contentType('application/json')
            .send({ error: err.message })
        }

        // Trusted indexer scenario: if the sender provides the free
        // query auth token, we do not require a receipt
        let receiptRequired = true
        if (freeQueryAuthValue && req.headers['authorization'] === freeQueryAuthValue) {
          receiptRequired = false
        }

        if (receiptRequired) {
          // Regular scenario: a receipt is required; fail if no state channel
          // is specified
          if (receipt === undefined) {
            logger.info(`Query is missing a receipt`, {
              deployment: subgraphDeploymentID.display,
            })
            serverMetrics.queriesWithoutReceipt.inc({
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
            receipt: receipt,
          })

          try {
            const response = await queryProcessor.executePaidQuery({
              subgraphDeploymentID,
              receipt,
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
              .setHeader('graph-attestable', response.result.attestable.toString())
              .send({ graphQLResponse: response.result.graphQLResponse })
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
  networkSubgraph,
  networkSubgraphAuthToken,
  serveNetworkSubgraph,
}: ServerOptions): Promise<http.Server> => {
  const app = await createApp({
    logger,
    queryProcessor,
    freeQueryAuthToken,
    graphNodeStatusEndpoint,
    indexerManagementClient,
    metrics,
    release,
    operatorPublicKey,
    networkSubgraph,
    networkSubgraphAuthToken,
    serveNetworkSubgraph,
  })

  return app.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })
}
