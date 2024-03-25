import { COST_MODEL_GLOBAL } from '../../../../indexer-management/models'
import type { QueryResolvers } from './../../../types.generated'

export const costModels: NonNullable<QueryResolvers['costModels']> = async (
  _parent,
  { deployments },
  { models },
) => {
  const costModels = await models.CostModel.findAll({
    where: deployments ? { deployment: deployments } : undefined,
    order: [['deployment', 'ASC']],
  })

  const definedDeployments = new Set(costModels.map((model) => model.deployment))
  const undefinedDeployments = deployments?.filter((d) => !definedDeployments.has(d))

  const globalModel = await models.CostModel.findOne({
    where: { deployment: COST_MODEL_GLOBAL },
  })

  if (globalModel && undefinedDeployments) {
    const mergedCostModels = undefinedDeployments.map((d) => {
      globalModel.setDataValue('deployment', d)
      return globalModel.toGraphQL()
    })
    return costModels.map((model) => model.toGraphQL()).concat(mergedCostModels)
  }

  return costModels.map((model) => model.toGraphQL())
}
