import {
  CostModelVariables,
  parseGraphQLCostModel,
} from '../../../../indexer-management/models/cost-model'
import type { MutationResolvers } from './../../../types.generated'
import { compileAsync } from '@graphprotocol/cost-model'

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

export const setCostModel: NonNullable<MutationResolvers['setCostModel']> = async (
  _parent,
  { costModel },
  { multiNetworks, models, dai },
) => {
  if (!multiNetworks) {
    throw new Error('No network configuration available')
  }

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
    const oldDai = model.variables?.DAI
    const newDai = update.variables?.DAI

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
}
