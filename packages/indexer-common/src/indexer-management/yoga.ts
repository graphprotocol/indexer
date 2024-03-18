import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from '../schema/typeDefs.generated'
import { resolvers } from '../schema/resolvers.generated'
import { IndexerManagementResolverContext } from './context'
import { WritableEventual, mutable } from '@graphprotocol/common-ts'
import { ActionManager } from './actions'
import { IndexerManagementClientOptions } from './client'

export const createIndexerManagementYogaClient = async (
  options: IndexerManagementClientOptions,
) => {
  const { models, graphNode, logger, defaults, multiNetworks } = options

  const dai: WritableEventual<string> = mutable()

  const actionManager = multiNetworks
    ? await ActionManager.create(multiNetworks, logger, models, graphNode)
    : undefined

  return createYoga<IndexerManagementResolverContext>({
    schema: createSchema({ typeDefs, resolvers }),
    context: {
      models,
      graphNode,
      defaults,
      logger: logger.child({ component: 'IndexerManagementClient' }),
      dai,
      multiNetworks,
      actionManager,
    },
  })
}
