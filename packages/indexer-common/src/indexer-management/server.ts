import { Stream } from 'stream'
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import { Logger } from '@graphprotocol/common-ts'

import http from 'http'
import { IndexerManagementYogaClient } from './yoga'

export interface CreateIndexerManagementServerOptions {
  logger: Logger
  client: IndexerManagementYogaClient
  port: number
}

export const createIndexerManagementServer = async ({
  logger,
  client,
  port,
}: CreateIndexerManagementServerOptions): Promise<http.Server> => {
  logger = logger.child({ component: 'IndexerManagementServer' })

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

  // Endpoint for health checks
  app.get('/', (_, res) => {
    res.status(200).send('Ready to roll!')
  })

  // GraphQL endpoint
  app.post('/', bodyParser.json(), async (req, res) => {
    return client.yoga.handle(req, res)
  })

  const server = app.listen(port, () => {
    logger.debug(`Listening on port ${port}`)
  })

  return server
}
