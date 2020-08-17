import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { QueryProcessor } from '../types'
import { utils } from 'ethers'
import { createGraphQLServer } from './graphql'
import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { PaymentManager } from '../payment-manager'

export interface ServerOptions {
  logger: Logger
  metrics?: Metrics
  port?: number
  paymentManager: PaymentManager
  queryProcessor: QueryProcessor
  freeQueryAuthToken: string
  graphNodeStatusEndpoint: string
}

export const createApp = async ({
  logger,
  paymentManager,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
}: ServerOptions): Promise<express.Express> => {
  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const app = express()

  // Log requests to the logger stream
  app.use(morgan('tiny', { stream: loggerStream }))
  app.use(cors())

  // Endpoint for health checks
  app.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // Endpoint for the public status GraphQL API
  app.use(
    '/status',
    bodyParser.json(),
    await createGraphQLServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for subgraph queries
  app.post(
    '/subgraphs/id/:id',

    // Accept JSON but don't parse it
    bodyParser.raw({ type: 'application/json' }),

    async (req, res) => {
      const { id } = req.params
      const query = req.body.toString()

      const subgraphDeploymentID = new SubgraphDeploymentID(id)

      // Extract the payment
      const envelopedPayment = req.headers['x-graph-payment']
      if (envelopedPayment !== undefined && typeof envelopedPayment !== 'string') {
        logger.info(`Query has invalid enveloped payment`, {
          deployment: subgraphDeploymentID.display,
          envelopedPayment,
        })
        return res
          .status(402)
          .contentType('application/json')
          .send({ error: 'Invalid X-Graph-Payment provided' })
      }

      // Trusted indexer scenario: if the sender provides the free
      // query auth token, we do not require payment
      const paymentRequired =
        req.headers['authorization'] !== `Bearer ${freeQueryAuthToken}`

      if (paymentRequired) {
        // Regular scenario: a payment is required; fail if no
        // state channel is specified
        if (envelopedPayment === undefined) {
          logger.info(`Query is missing signed state`, {
            deployment: subgraphDeploymentID.display,
          })
          return res
            .status(402)
            .contentType('application/json')
            .send({ error: 'No X-Graph-Payment provided' })
        }

        logger.info(`Received paid query`, {
          deployment: subgraphDeploymentID.display,
          envelopedPayment,
        })

        try {
          const { message: stateChannelMessage, allocationID } = JSON.parse(
            envelopedPayment,
          )

          const response = await queryProcessor.executePaidQuery({
            allocationID,
            subgraphDeploymentID,
            stateChannelMessage,
            query,
            requestCID: utils.keccak256(new TextEncoder().encode(query)),
          })

          res
            .status(response.status || 200)
            .header('x-graph-payment', response.envelopedAttestation)
            .contentType('application/json')
            .send(response.result)
        } catch (error) {
          logger.error(`Failed to handle paid query`, { error: error.message })
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
    },
  )

  // Endpoint for channel messages
  app.post(
    '/channel-messages-inbox',

    // Accept JSON and parse it
    bodyParser.json(),

    async (req, res) => {
      const { sender, recipient, data } = req.body

      const allocationId = paymentManager.getAllocationIdFromMessage(req.body)

      const client = paymentManager.getAllocationPaymentClient(allocationId)

      if (!client)
        return res
          .status(500)
          .contentType('application/json')
          .send({
            error: `Indexer at ${req.url} does not recognize allocation ${allocationId}`,
          })

      try {
        const response = await client.handleMessage({ sender, recipient, data })
        logger.info(`Handled channel creation successfully`, {
          sender,
          recipient,
        })
        return res.status(200).send(response)
      } catch (error) {
        logger.error(`Failed to handle state channel message`, {
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
  paymentManager,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
}: ServerOptions): Promise<express.Express> => {
  const app = await createApp({
    logger,
    paymentManager,
    queryProcessor,
    freeQueryAuthToken,
    graphNodeStatusEndpoint,
  })

  app.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return app
}
