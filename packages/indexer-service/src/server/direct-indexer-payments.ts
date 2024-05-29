import { Request, Response } from 'express'

import {
  IndexerManagementClient,
  generateIndexingPaymentsSchema,
} from '@graphprotocol/indexer-common'
import { graphqlHTTP } from 'express-graphql'

export const createIndexingPaymentServer = async (
  client: IndexerManagementClient,
): Promise<(request: Request, response: Response) => Promise<void>> => {
  return graphqlHTTP({
    schema: generateIndexingPaymentsSchema(),
    graphiql: false,
    context: client,
    customFormatErrorFn: error => {
      console.error(error)
      return error
    },
  })
}
