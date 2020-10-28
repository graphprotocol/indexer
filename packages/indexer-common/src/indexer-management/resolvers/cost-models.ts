/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import { CostModelVariables, GraphQLCostModel, parseGraphQLCostModel } from '../models'
import { IndexerManagementResolverContext } from '../client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getVariable = (vars: CostModelVariables | null, name: string): any | undefined => {
  if (vars === null) {
    return undefined
  } else {
    try {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        return vars[name]
      } else {
        return undefined
      }
    } catch (e) {
      return undefined
    }
  }
}

const setVariable = (
  vars: CostModelVariables | null,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
): CostModelVariables => {
  if (vars === null) {
    return { [name]: value }
  } else {
    try {
      vars[name] = value
      return vars
    } catch (e) {
      return vars
    }
  }
}

export default {
  costModel: async (
    { deployment }: { deployment: string },
    { models }: IndexerManagementResolverContext,
  ): Promise<object | null> => {
    const model = await models.CostModel.findOne({
      where: { deployment },
    })
    return model?.toGraphQL() || null
  },

  costModels: async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { deployments }: { deployments: string[] | null | undefined },
    { models }: IndexerManagementResolverContext,
  ): Promise<object[]> => {
    const costModels = await models.CostModel.findAll({
      where: deployments ? { deployment: deployments } : undefined,
      order: [['deployment', 'ASC']],
    })
    return costModels.map((model) => model.toGraphQL())
  },

  setCostModel: async (
    { costModel }: { deployment: string; costModel: GraphQLCostModel },
    { models, features, dai }: IndexerManagementResolverContext,
  ): Promise<object> => {
    const update = parseGraphQLCostModel(costModel)

    const [model] = await models.CostModel.findOrBuild({
      where: { deployment: update.deployment },
    })
    model.deployment = costModel.deployment || model.deployment
    model.model =
      costModel.model !== null && costModel.model !== undefined
        ? costModel.model
        : model.model

    // Update the model variables (fall back to current value if unchanged)
    let variables = update.variables || model.variables

    if (features.injectDai) {
      const oldDai = getVariable(model.variables, 'DAI')
      const newDai = getVariable(update.variables, 'DAI')

      // Inject the latest DAI value if available
      if (dai.valueReady) {
        variables = setVariable(variables, 'DAI', await dai.value())
      } else if (newDai === undefined && oldDai !== undefined) {
        // Otherwise preserve the old DAI value if there is one;
        // this ensures it's never dropped
        variables = setVariable(variables, 'DAI', oldDai)
      }
    }

    // Apply new variables
    model.variables = variables

    return (await model.save()).toGraphQL()
  },
}
