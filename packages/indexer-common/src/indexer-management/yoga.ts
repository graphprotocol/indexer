import { createYoga, createSchema } from 'graphql-yoga'
import { typeDefs } from '../schema/typeDefs.generated'
import { resolvers } from '../schema/resolvers.generated'
import { IndexerManagementDefaults, IndexerManagementResolverContext } from './context'
import { Logger, WritableEventual, equal, mutable } from '@graphprotocol/common-ts'
import { ActionManager } from './actions'
import { Op, Sequelize } from 'sequelize'
import { IndexerManagementModels } from './models'
import { GraphNode } from '../graph-node'
import { MultiNetworks } from '../multi-networks'
import { Network } from '../network'

interface IndexerManagementClientOptions {
  logger: Logger
  models: IndexerManagementModels
  graphNode: GraphNode
  multiNetworks: MultiNetworks<Network> | undefined
  defaults: IndexerManagementDefaults
}

export async function createIndexerManagementYogaClient(
  options: IndexerManagementClientOptions,
) {
  const { models, graphNode, logger, defaults, multiNetworks } = options

  const dai: WritableEventual<string> = mutable()

  const actionManager = multiNetworks
    ? await ActionManager.create(multiNetworks, logger, models, graphNode)
    : undefined

  async function setDai(value: string): Promise<void> {
    // Get current value
    const oldValue = dai.valueReady ? await dai.value() : undefined

    // Don't do anything if there is no change
    if (equal(oldValue, value)) {
      return
    }

    // Notify others of the new value
    dai.push(value)

    // Update DAI in all cost models
    const update = `'${JSON.stringify({ DAI: value })}'::jsonb`
    await models.CostModel.update(
      {
        // This merges DAI into the variables, overwriting existing values
        variables: Sequelize.literal(`coalesce(variables, '{}'::jsonb) || ${update}`),
      },
      {
        // TODO: update to match all rows??
        where: { model: { [Op.not]: null } },
      },
    )
  }

  return {
    setDai,
    yoga: createYoga<IndexerManagementResolverContext>({
      graphqlEndpoint: '*',
      schema: createSchema({ typeDefs, resolvers }),
      maskedErrors: false,
      context: {
        models,
        graphNode,
        defaults,
        logger: logger.child({ component: 'IndexerManagementClient' }),
        dai,
        multiNetworks,
        actionManager,
      },
    }),
  }
}

export type IndexerManagementYogaClient = Awaited<
  ReturnType<typeof createIndexerManagementYogaClient>
>
