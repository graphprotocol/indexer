import { Request, Response } from 'express'

import { generateIndexingPaymentsSchema } from '@graphprotocol/indexer-common'
import { graphqlHTTP } from 'express-graphql'
import { IndexingPaymentResolverContext } from 'indexer-common/src/direct-indexer-payments/resolvers'

export const createIndexingPaymentServer = async (
  context: IndexingPaymentResolverContext,
): Promise<(request: Request, response: Response) => Promise<void>> => {
  return graphqlHTTP({
    schema: generateIndexingPaymentsSchema(),
    graphiql: false,
    context,
    customFormatErrorFn: error => {
      console.error(error)
      return error
    },
  })
}
