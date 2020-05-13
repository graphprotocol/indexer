import express, { response } from 'express'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Stream } from 'stream'
import { logging, metrics } from '@graphprotocol/common-ts'
import { QueryProcessor } from './types'
import { keccak256 } from 'ethers/utils'

export interface ServerOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  port: number
  queryProcessor: QueryProcessor
  whitelist: string[]
}

export const createServer = ({
  logger,
  metrics,
  port,
  queryProcessor,
  whitelist,
}: ServerOptions) => {
  let loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  let server = express()

  // Log requests to the logger stream
  server.use(morgan('tiny', { stream: loggerStream }))

  // Accept JSON but don't parse it
  server.use(bodyParser.raw({ type: 'application/json' }))

  // Endpoint for health checks
  server.get('/', (_, res, __) => {
    res.status(200).send('Ready to roll!')
  })

  server.post('/subgraphs/id/:id', async (req, res, _) => {
    let { id: subgraphId } = req.params
    let query = req.body.toString()

    // Extract the payment ID
    let paymentId = req.headers['x-graph-payment-id']
    if (paymentId !== undefined && typeof paymentId !== 'string') {
      logger.info(`Query for subgraph '${subgraphId}' has invalid payment ID`)
      return res
        .status(402)
        .contentType('application/json')
        .send({ error: 'Invalid X-Graph-Payment-Id provided' })
    }

    // Trusted indexer scenario: if the source IP is in our whitelist,
    // we do not require payment; however, if there _is_ a payment,
    // we still take it
    let paymentRequired = !whitelist.includes(req.ip)

    if (paymentRequired) {
      // Regular scenario: a payment is required; fail if no
      // payment ID is specified
      if (paymentId === undefined) {
        logger.info(`Query for subgraph '${subgraphId}' is missing payment ID`)
        return res
          .status(402)
          .contentType('application/json')
          .send({ error: 'No X-Graph-Payment-Id provided' })
      }
    }

    if (paymentId !== undefined) {
      logger.info(
        `Received paid query for subgraph '${subgraphId}' (payment ID: ${paymentId})`,
      )
      try {
        let response = await queryProcessor.addPaidQuery({
          subgraphId,
          paymentId,
          query,
          requestCID: keccak256(new TextEncoder().encode(query)),
        })
        res
          .status(response.status || 200)
          .contentType('application/json')
          .send(response.result)
      } catch (e) {
        logger.error(`Failed to handle paid query: ${e}`)
        res
          .status(e.status || 500)
          .contentType('application/json')
          .send({ error: `${e.message}` })
      }
    } else {
      logger.info(`Received free query for subgraph '${subgraphId}'`)
      try {
        let response = await queryProcessor.addFreeQuery({
          subgraphId,
          query,
          requestCID: keccak256(new TextEncoder().encode(query)),
        })
        res
          .status(response.status || 200)
          .contentType('application/json')
          .send(response.result)
      } catch (e) {
        logger.error(`Failed to handle free query: ${e}`)
        res
          .status(e.status || 500)
          .contentType('application/json')
          .send({ error: `${e.message}` })
      }
    }
  })

  server.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
