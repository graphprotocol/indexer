import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import {
  QueryProcessor,
  withContext,
  PaidQueryResponse,
  FreeQueryResponse,
} from '../types'
import { utils } from 'ethers'
import { createGraphQLServer } from './graphql'
import { Logger, Metrics, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { parsePaymentAppState } from '../payments'

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

      let response: PaidQueryResponse | FreeQueryResponse

      try {
        // Trusted indexer scenario: if the sender provides the free
        // query auth token, we do not require payment
        const paymentRequired =
          req.headers['authorization'] !== `Bearer ${freeQueryAuthToken}`

        if (paymentRequired) {
          const paymentAppState = withContext(
            'Parsing X-Graph-Payment',
            () => parsePaymentAppState(req.headers['x-graph-payment']),
            402,
          )

          logger.info(`Received paid query`, {
            deployment: subgraphDeploymentID.display,
            paymentAppState,
          })

          response = await queryProcessor.executePaidQuery({
            subgraphDeploymentID,
            paymentAppState,
            query,
            requestCID: utils.keccak256(new TextEncoder().encode(query)),
          })
        } else {
          logger.info(`Received free query`, { deployment: subgraphDeploymentID.display })
          response = await queryProcessor.executeFreeQuery({
            subgraphDeploymentID,
            query,
            requestCID: utils.keccak256(new TextEncoder().encode(query)),
          })
        }
      } catch (error) {
        logger.error(`Failed to handle query`, { error: error.message })
        return res
          .status(error.status ?? 500)
          .contentType('application/json')
          .send({ error: `${error.message}` })
      }

      return res
        .status(response.status)
        .contentType('application/json')
        .send(response.result)
    },
  )

  server.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
