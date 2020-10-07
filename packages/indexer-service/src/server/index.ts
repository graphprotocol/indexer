import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { QueryProcessor } from '../types'
import { utils } from 'ethers'
import { createStatusServer } from './status'
import {
  Logger,
  Metrics,
  SubgraphDeploymentID,
  secureExpressApp,
} from '@graphprotocol/common-ts'
import { IndexerManagementClient } from '@graphprotocol/indexer-common'
import { ReceiptManager } from '@graphprotocol/receipt-manager'
import { createCostServer } from './cost'

export interface ServerOptions {
  logger: Logger
  metrics: Metrics
  port?: number
  receiptManager: ReceiptManager
  queryProcessor: QueryProcessor
  freeQueryAuthToken: string | undefined
  graphNodeStatusEndpoint: string
  indexerManagementClient: IndexerManagementClient
}

export const createApp = async ({
  logger,
  receiptManager,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
  indexerManagementClient,
  metrics,
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
  }

  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const app = express()

  // Log requests to the logger stream
  app.use(morgan('tiny', { stream: loggerStream }))
  app.use(cors())

  // Security
  secureExpressApp(app)

  // Endpoint for health checks
  app.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // Endpoint for the public status API
  app.use(
    '/status',
    bodyParser.json(),
    await createStatusServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for the public cost API
  app.use('/cost', bodyParser.json(), await createCostServer({ indexerManagementClient }))

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
        deployment: subgraphDeploymentID.bytes32,
      })
      serverMetrics.queries.inc({ deployment: subgraphDeploymentID.bytes32 })

      try {
        // Extract the payment
        const envelopedPayment = req.headers['x-graph-payment']
        if (envelopedPayment !== undefined && typeof envelopedPayment !== 'string') {
          logger.info(`Query has invalid enveloped payment`, {
            deployment: subgraphDeploymentID.display,
            envelopedPayment,
          })
          serverMetrics.queriesWithInvalidPaymentHeader.inc({
            deployment: subgraphDeploymentID.bytes32,
          })
          return res
            .status(402)
            .contentType('application/json')
            .send({ error: 'Invalid X-Graph-Payment header provided' })
        }

        // Trusted indexer scenario: if the sender provides the free
        // query auth token, we do not require payment
        let paymentRequired = true
        if (freeQueryAuthValue) {
          paymentRequired = req.headers['authorization'] == freeQueryAuthValue
        }

        if (paymentRequired) {
          // Regular scenario: a payment is required; fail if no
          // state channel is specified
          if (envelopedPayment === undefined) {
            logger.info(`Query is missing signed state`, {
              deployment: subgraphDeploymentID.display,
            })
            serverMetrics.queriesWithoutPayment.inc({
              deployment: subgraphDeploymentID.bytes32,
            })
            return res
              .status(402)
              .contentType('application/json')
              .send({ error: 'No X-Graph-Payment provided' })
          }

          logger.info(`Received paid query`, {
            deployment: subgraphDeploymentID.display,
          })

          let stateChannelMessage
          let allocationID
          try {
            const parsed = JSON.parse(envelopedPayment)
            stateChannelMessage = parsed.message
            allocationID = parsed.allocationID
          } catch (error) {
            serverMetrics.queriesWithInvalidPaymentValue.inc({
              deployment: subgraphDeploymentID.bytes32,
            })
            return res
              .status(400)
              .contentType('application/json')
              .send({ error: 'Invalid X-Graph-Payment value provided' })
          }

          try {
            const response = await queryProcessor.executePaidQuery({
              allocationID,
              subgraphDeploymentID,
              stateChannelMessage,
              query,
              requestCID: utils.keccak256(new TextEncoder().encode(query)),
            })
            serverMetrics.successfulQueries.inc({
              deployment: subgraphDeploymentID.bytes32,
            })
            res
              .status(response.status || 200)
              .header('x-graph-payment', response.envelopedAttestation)
              .contentType('application/json')
              .send(response.result)
          } catch (error) {
            logger.error(`Failed to handle paid query`, { error: error.message })
            serverMetrics.failedQueries.inc({ deployment: subgraphDeploymentID.bytes32 })
            res
              .status(error.status || 500)
              .contentType('application/json')
              .send({ error: `${error.message}` })
          }
        } else {
          logger.info(`Received free query`, { deployment: subgraphDeploymentID.display })

          try {
            const response = await queryProcessor.executeFreeQuery({
              subgraphDeploymentID,
              query,
              requestCID: utils.keccak256(new TextEncoder().encode(query)),
            })
            res
              .status(response.status || 200)
              .contentType('application/json')
              .send(response.result)
          } catch (error) {
            logger.error(`Failed to handle free query`, { error: error.message })
            res
              .status(error.status || 500)
              .contentType('application/json')
              .send({ error: `${error.message}` })
          }
        }
      } finally {
        stopQueryTimer()
      }
    },
  )

  // Endpoint for channel messages
  app.post(
    '/channel-messages-inbox',

    // Accept JSON and parse it
    bodyParser.json({ limit: '5mb' }),

    async (req, res) => {
      try {
        const response = await receiptManager.inputStateChannelMessage(req.body)
        return res.status(200).send(response)
      } catch (error) {
        logger.error(`Failed to handle state channel message`, {
          body: req.body,
          headers: req.headers,
          error: error.message,
        })
        return res.status(500).send({ error: error.message })
      }
    },
  )
  return app
}

export const createServer = async ({
  logger,
  port,
  receiptManager,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
  indexerManagementClient,
  metrics,
}: ServerOptions): Promise<express.Express> => {
  const app = await createApp({
    logger,
    receiptManager,
    queryProcessor,
    freeQueryAuthToken,
    graphNodeStatusEndpoint,
    indexerManagementClient,
    metrics,
  })

  app.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return app
}
