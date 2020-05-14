import graphqlHTTP from 'express-graphql'
import fetch from 'cross-fetch'
import { HttpLink } from 'apollo-link-http'
import {
  introspectSchema,
  makeRemoteExecutableSchema,
  transformSchema,
  FilterRootFields,
} from 'graphql-tools'

export interface GraphQLServerOptions {
  graphNodeStatusEndpoint: string
}

export const createGraphQLServer = async ({
  graphNodeStatusEndpoint,
}: GraphQLServerOptions) => {
  let nodeLink = new HttpLink({ uri: graphNodeStatusEndpoint, fetch })
  let nodeSchema = await introspectSchema(nodeLink)
  let schema = transformSchema(nodeSchema, [
    new FilterRootFields(
      (_operation, fieldName, _field) => fieldName === 'indexingStatuses',
    ),
  ])
  let executableSchema = makeRemoteExecutableSchema({
    schema: schema,
    link: nodeLink,
  })

  return graphqlHTTP({
    schema: executableSchema,
    graphiql: true,
  })
}
