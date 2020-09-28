import graphqlHTTP from 'express-graphql'
import fetch from 'cross-fetch'
import { HttpLink } from 'apollo-link-http'
import {
  introspectSchema,
  makeRemoteExecutableSchema,
  transformSchema,
  FilterRootFields,
} from 'graphql-tools'

export interface StatusServerOptions {
  graphNodeStatusEndpoint: string
}

export const createStatusServer = async ({
  graphNodeStatusEndpoint,
}: StatusServerOptions): Promise<graphqlHTTP.Middleware> => {
  const nodeLink = new HttpLink({ uri: graphNodeStatusEndpoint, fetch })
  const nodeSchema = await introspectSchema(nodeLink)
  const schema = transformSchema(nodeSchema, [
    new FilterRootFields((_operation, fieldName) => fieldName === 'indexingStatuses'),
  ])
  const executableSchema = makeRemoteExecutableSchema({
    schema: schema,
    link: nodeLink,
  })

  return graphqlHTTP({
    schema: executableSchema,
    graphiql: true,
  })
}
