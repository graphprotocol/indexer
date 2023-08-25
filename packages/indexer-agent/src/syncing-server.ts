import { Stream } from 'stream'
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Logger } from '@graphprotocol/common-ts'
import { parse } from 'graphql'
import {
  NetworkMapped,
  NetworkSubgraph,
  resolveChainId,
} from '@graphprotocol/indexer-common'

export interface CreateSyncingServerOptions {
  logger: Logger
  networkSubgraphs: NetworkMapped<NetworkSubgraph>
  port: number
}

export const createSyncingServer = async ({
  logger,
  networkSubgraphs,
  port,
}: CreateSyncingServerOptions): Promise<express.Express> => {
  logger = logger.child({ component: 'SyncingServer' })

  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const server = express()

  // Log requests to the logger stream
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.use(morgan('tiny', { stream: loggerStream }) as any)
  server.use(cors())

  // Endpoint for health checks
  server.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // Network subgraph endpoint
  server.post(
    '/network/:networkIdentifier',
    bodyParser.json(),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async (req, res) => {
      const { query, variables } = req.body
      const { networkIdentifier: unvalidatedNetworkIdentifier } = req.params

      if (query.startsWith('mutation') || query.startsWith('subscription')) {
        return res.status(405).send('Only queries are supported')
      }

      let networkIdentifier
      try {
        networkIdentifier = resolveChainId(unvalidatedNetworkIdentifier)
      } catch (e) {
        return res
          .status(404)
          .send(`Unknown network identifier: '${unvalidatedNetworkIdentifier}'`)
      }

      const networkSubgraph = networkSubgraphs[networkIdentifier]
      if (!networkSubgraph) {
        return res
          .status(404)
          .send(
            `Indexer Agent not configured for network '${networkIdentifier}'`,
          )
      }

      let parsedQuery
      try {
        parsedQuery = parse(query)
      } catch (e) {
        return res.status(400).send('Malformed GraphQL query')
      }

      let result
      try {
        result = await networkSubgraph.query(parsedQuery, variables)
      } catch (err) {
        logger.error(err)
        return res.status(400).send({ error: err.message })
      }

      return res.status(200).send({
        data: result.data,
        errors: result.error ? result.error.graphQLErrors : null,
        extensions: result.extensions,
      })
    },
  )

  server.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
