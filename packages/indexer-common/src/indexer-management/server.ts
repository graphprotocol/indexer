import { Stream } from 'stream'
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Logger } from '@graphprotocol/common-ts'

import { IndexerManagementClient } from './client'

export interface CreateIndexerManagementServerOptions {
  logger: Logger
  client: IndexerManagementClient
  port: number
}

export const createIndexerManagementServer = async ({
  logger,
  client,
  port,
}: CreateIndexerManagementServerOptions): Promise<express.Express> => {
  logger = logger.child({ component: 'IndexerManagementServer' })

  const loggerStream = new Stream.Writable()
  loggerStream._write = (chunk, _, next) => {
    logger.debug(chunk.toString().trim())
    next()
  }

  const server = express()

  // Log requests to the logger stream
  server.use(morgan('tiny', { stream: loggerStream }))
  server.use(cors())

  // Endpoint for health checks
  server.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // GraphQL endpoint
  server.post('/', bodyParser.json(), async (req, res) => {
    const { query, variables } = req.body

    const result = query.startsWith('mutation')
      ? await client.mutation(query, variables).toPromise()
      : await client.query(query, variables).toPromise()

    res.status(200).send({
      data: result.data,
      errors: result.error ? result.error.graphQLErrors : null,
      extensions: result.extensions,
    })
  })

  server.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
