import {
  IndexerManagementDefaults,
  IndexerManagementModels,
  MultiNetworks,
  Network,
  validateNetworkIdentifier,
} from '@graphprotocol/indexer-common'
import { IndexingRuleIdentifier } from '../../types.generated'
import { Transaction } from 'sequelize'

export function extractNetwork(
  unvalidatedNetworkIdentifier: string,
  multiNetworks: MultiNetworks<Network>,
): Network {
  let networkIdentifier: string
  try {
    networkIdentifier = validateNetworkIdentifier(unvalidatedNetworkIdentifier)
  } catch (parseError) {
    throw new Error(
      `Invalid protocol network identifier: '${unvalidatedNetworkIdentifier}'. Error: ${parseError}`,
    )
  }
  const network = multiNetworks.inner[networkIdentifier]
  if (!network) {
    throw new Error(
      `Could not find a configured protocol network named ${networkIdentifier}`,
    )
  }
  return network
}

export const resetGlobalRule = async (
  ruleIdentifier: IndexingRuleIdentifier,
  defaults: IndexerManagementDefaults['globalIndexingRule'],
  models: IndexerManagementModels,
  transaction: Transaction,
) => {
  await models.IndexingRule.upsert(
    {
      ...defaults,
      ...ruleIdentifier,
      allocationAmount: defaults.allocationAmount.toString(),
    },
    { transaction },
  )
}
