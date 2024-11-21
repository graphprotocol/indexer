/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import { COST_MODEL_GLOBAL, GraphQLCostModel, parseGraphQLCostModel } from '../models'
import { IndexerManagementResolverContext } from '../client'
import { compileAsync } from '@graphprotocol/cost-model'

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
       variables,
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

    // Validate cost model
    try {
      const modelForValidation = update.model || 'default => 1;'
      const variablesForValidation = JSON.stringify(update.variables || {})
      await compileAsync(modelForValidation, variablesForValidation)
    } catch (err) {
      throw new Error(`Invalid cost model or variables: ${err.message}`)
    }
    const oldModel = await models.CostModel.findOne({
      where: { deployment: update.deployment },
      order: [['id', 'DESC']],
    })
    const model = models.CostModel.build({
      deployment: update.deployment,
      model: update.model || oldModel?.model,
      variables: update.variables || oldModel?.variables,
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
