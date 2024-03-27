import type { MutationResolvers } from './../../../types.generated'

export const deleteCostModels: NonNullable<
  MutationResolvers['deleteCostModels']
> = async (_parent, { deployments }, { models }) => {
  return await models.CostModel.sequelize!.transaction(async (transaction) => {
    return await models.CostModel.destroy({
      where: {
        deployment: deployments,
      },
      transaction,
    })
  })
}
