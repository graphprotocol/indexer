import { graphqlHTTP } from 'express-graphql'
import fetch from 'cross-fetch'
import { loadSchema } from '@graphql-tools/load'
import { UrlLoader } from '@graphql-tools/url-loader'
import { wrapSchema, FilterRootFields } from '@graphql-tools/wrap'
import { Request, Response } from 'express'

export interface StatusServerOptions {
  graphNodeStatusEndpoint: string
}

export const createStatusServer = async ({
  graphNodeStatusEndpoint,
}: StatusServerOptions): Promise<
  (request: Request, response: Response) => Promise<void>
> => {
  const schema = await loadSchema(graphNodeStatusEndpoint, {
    loaders: [new UrlLoader()],
    headers: {
      Accept: 'application/json',
    },
    method: 'POST',
    fetch,
  })

  const filteredSchema = wrapSchema({
    schema,
    transforms: [
      new FilterRootFields(
        (_operation: 'Query' | 'Mutation' | 'Subscription', rootFieldName: string) =>
          rootFieldName === 'indexingStatuses',
      ),
    ],
  })

  return graphqlHTTP({
    schema: filteredSchema,
    graphiql: true,
  })
}
