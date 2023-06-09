import { Stream } from 'stream'
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Logger } from '@graphprotocol/common-ts'
import { NetworkMapped, NetworkSubgraph } from '@graphprotocol/indexer-common'

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
    async (req, res) => {
      const { query, variables } = req.body
      const { networkIdentifier } = req.params
      if (query.startsWith('mutation') || query.startsWith('subscription')) {
        return res.status(405).send('Only queries are supported')
      }

      const networkSubgraph = networkSubgraphs[networkIdentifier]

      const result = await networkSubgraph.query(query, variables)

      res.status(200).send({
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
