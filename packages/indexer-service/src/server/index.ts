import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { QueryProcessor } from '../types'
import { utils } from 'ethers'
import { createGraphQLServer } from './graphql'
import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'

export interface ServerOptions {
  logger: Logger
  metrics: Metrics
  port: number
  queryProcessor: QueryProcessor
  freeQueryAuthToken: string
  graphNodeStatusEndpoint: string
}

export const createServer = async ({
  logger,
  port,
  queryProcessor,
  freeQueryAuthToken,
  graphNodeStatusEndpoint,
}: ServerOptions): Promise<express.Express> => {
  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const server = express()

  // Log requests to the logger stream
  server.use(morgan('tiny', { stream: loggerStream }))
  server.use(cors())

  // server.use(bodyParser.raw({ type: 'application/json' }))

  // Endpoint for health checks
  server.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // Endpoint for the public status GraphQL API
  server.use(
    '/status',
    bodyParser.json(),
    await createGraphQLServer({ graphNodeStatusEndpoint }),
  )

  // Endpoint for subgraph queries
  server.post(
    '/subgraphs/id/:id',

    // Accept JSON but don't parse it
    bodyParser.raw({ type: 'application/json' }),

    async (req, res) => {
      const { id } = req.params
      const query = req.body.toString()

      const subgraphDeploymentID = new SubgraphDeploymentID(id)

      // Extract the payment ID
      const paymentId = req.headers['x-graph-payment-id']
      if (paymentId !== undefined && typeof paymentId !== 'string') {
        logger.info(`Query has invalid payment ID`, {
          deployment: subgraphDeploymentID.display,
          paymentId,
        })
        return res
          .status(402)
          .contentType('application/json')
          .send({ error: 'Invalid X-Graph-Payment-ID provided' })
      }

      // Trusted indexer scenario: if the sender provides the free
      // query auth token, we do not require payment; however, if
      // there _is_ a payment, we still take it
      const paymentRequired =
        req.headers['authorization'] !== `Bearer ${freeQueryAuthToken}`

      if (paymentRequired) {
        // Regular scenario: a payment is required; fail if no
        // payment ID is specified
        if (paymentId === undefined) {
          logger.info(`Query is missing payment ID`, {
            deployment: subgraphDeploymentID.display,
          })
          return res
            .status(402)
            .contentType('application/json')
            .send({ error: 'No X-Graph-Payment-ID provided' })
        }
      }

      if (paymentId !== undefined) {
        logger.info(`Received paid query`, {
          deployment: subgraphDeploymentID.display,
          paymentId,
        })
        try {
          const response = await queryProcessor.addPaidQuery({
            subgraphDeploymentID,
            paymentId,
            query,
            requestCID: utils.keccak256(new TextEncoder().encode(query)),
          })
          res
            .status(response.status || 200)
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

        // Extract the state channel ID (only required for free queries)
        try {
          const response = await queryProcessor.addFreeQuery({
            subgraphDeploymentID,
            query,
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

  server.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
