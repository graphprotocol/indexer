import { COST_MODEL_GLOBAL } from 'indexer-common/src/indexer-management/models'
import type { QueryResolvers } from './../../../types.generated'

export const costModel: NonNullable<QueryResolvers['costModel']> = async (
  _parent,
  { deployment },
  { models },
) => {
  const model = await models.CostModel.findOne({
    where: { deployment },
  })

  if (model) return model.toGraphQL()

  const globalModel = await models.CostModel.findOne({
    where: { deployment: COST_MODEL_GLOBAL },
  })

  if (globalModel) {
    globalModel.setDataValue('deployment', deployment)
    return globalModel.toGraphQL()
  }

  return null
}
