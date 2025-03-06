/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import { COST_MODEL_GLOBAL, GraphQLCostModel, parseGraphQLCostModel } from '../models'
import { IndexerManagementResolverContext } from '../client'

export default {
  costModel: async (
    { deployment }: { deployment: string },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const model = await models.CostModel.findOne({
      where: { deployment },
      order: [['id', 'DESC']],
    })
    if (model) {
      return model.toGraphQL()
    }

    const globalModel = await models.CostModel.findOne({
      where: { deployment: COST_MODEL_GLOBAL },
      order: [['id', 'DESC']],
    })
    if (globalModel) {
      globalModel.setDataValue('deployment', deployment)
      return globalModel.toGraphQL()
    }

    return null
  },

  costModels: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { deployments }: { deployments: string[] | null | undefined },
    { models }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const sequelize = models.CostModel.sequelize
    if (!sequelize) {
      throw new Error('No sequelize instance available')
    }
    const query = `
      SELECT id,
       deployment,
       model,
       "createdAt",
       "updatedAt"
      FROM "CostModelsHistory" t1
      JOIN
      (
          SELECT MAX(id)
          FROM "CostModelsHistory"
          ${deployments ? 'WHERE deployment IN (:deployments)' : ''}
          GROUP BY deployment
      ) t2
        ON t1.id = t2.MAX;
    `
    const costModels = await sequelize.query(query, {
      replacements: { deployments: deployments ? deployments : [] },
      mapToModel: true,
      model: models.CostModel,
    })
    const definedDeployments = new Set(costModels.map((model) => model.deployment))
    const undefinedDeployments = deployments?.filter((d) => !definedDeployments.has(d))
    const globalModel = await models.CostModel.findOne({
      where: { deployment: COST_MODEL_GLOBAL },
      order: [['id', 'DESC']],
    })
    if (globalModel && undefinedDeployments) {
      const mergedCostModels = undefinedDeployments.map((d) => {
        globalModel.setDataValue('deployment', d)
        return globalModel.toGraphQL()
      })
      return costModels.map((model) => model.toGraphQL()).concat(mergedCostModels)
    }

    return costModels.map((model) => model.toGraphQL())
  },

  setCostModel: async (
    { costModel }: { deployment: string; costModel: GraphQLCostModel },
    { models, multiNetworks }: IndexerManagementResolverContext,
  ): Promise<object> => {
    if (!multiNetworks) {
      throw new Error('No network configuration available')
    }
    if (Object.keys(multiNetworks.inner).length !== 1) {
      throw Error('Must be in single network mode to set cost models')
    }
    const update = parseGraphQLCostModel(costModel)

    // Validate cost model matches 'default => x;' where x is an integer or float
    const modelForValidation = update.model || 'default => 1;'
    if (!/^default\s*=>\s*\d+(\.\d+)?;$/.test(modelForValidation)) {
      throw new Error(
        'Invalid cost model: Cost model must be of the form "default => x;", where x is a literal value.',
      )
    }

    const oldModel = await models.CostModel.findOne({
      where: { deployment: update.deployment },
      order: [['id', 'DESC']],
    })

    const model = models.CostModel.build({
      deployment: update.deployment,
      model: update.model || oldModel?.model,
    })

    return (await model.save()).toGraphQL()
  },

  deleteCostModels: async (
    { deployments }: { deployments: string[] },
    { models }: IndexerManagementResolverContext,
  ): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await models.CostModel.sequelize!.transaction(async (transaction) => {
      return await models.CostModel.destroy({
        where: {
          deployment: deployments,
        },
        transaction,
      })
    })
  },
}
