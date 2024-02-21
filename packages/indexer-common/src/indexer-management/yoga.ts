import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from '../schema/typeDefs.generated'
import { resolvers } from '../schema/resolvers.generated'
import { IndexerManagementResolverContext } from './context'

const yoga = createYoga<IndexerManagementResolverContext>({
  schema: createSchema({ typeDefs, resolvers }),
  context: (req) => {},
})
