export * from './models'
export * from './abi'
export * from './queries'

import { makeExecutableSchema } from 'graphql-tools'
import { GraphQLSchema } from 'graphql'
import resolvers from './resolvers'
import { SCHEMA_SDL } from './schema'

export function generateIndexingPaymentsSchema(): GraphQLSchema {
  return makeExecutableSchema({
    typeDefs: SCHEMA_SDL,
    resolvers: resolvers,
  })
}
