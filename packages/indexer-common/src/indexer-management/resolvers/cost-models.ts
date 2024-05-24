/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import {
  CostModelVariables,
  COST_MODEL_GLOBAL,
  GraphQLCostModel,
  parseGraphQLCostModel,
} from '../models'
import { IndexerManagementResolverContext } from '../client'
import { compileAsync } from '@graphprotocol/cost-model'

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
    if (model) {
      return model.toGraphQL()
    }

    const globalModel = await models.CostModel.findOne({
      where: { deployment: COST_MODEL_GLOBAL },
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
  },

  setCostModel: async (
    { costModel }: { deployment: string; costModel: GraphQLCostModel },
    { models, multiNetworks, dai }: IndexerManagementResolverContext,
  ): Promise<object> => {
    if (Object.keys(multiNetworks.inner).length !== 1) {
      throw Error('Must be in single network mode to set cost models')
    }
    const network = Object.values(multiNetworks.inner)[0]
    const injectDai = network.specification.dai.inject
    if (network.specification.networkIdentifier !== 'eip155:1' && injectDai) {
      throw new Error(
        `Can't set cost model: DAI injection enabled but not on Ethereum Mainnet`,
      )
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
    const [model] = await models.CostModel.findOrBuild({
      where: { deployment: update.deployment },
    })
    // logger.info('Fetched current model', { current: model, update })
    // model.set('deployment', update.deployment || model.deployment)
    // // model.set('model', update.model || model.model)
    // model.model = update.model || model.model
    // logger.info('Merged models', { now: model })
    model.deployment = update.deployment || model.deployment
    model.model = update.model || model.model

    // Update the model variables (fall back to current value if unchanged)
    let variables = update.variables || model.variables

    if (injectDai) {
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
