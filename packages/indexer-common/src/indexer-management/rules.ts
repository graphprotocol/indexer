import { Eventual, join, Logger } from '@graphprotocol/common-ts'
import {
  IndexerManagementModels,
  INDEXING_RULE_GLOBAL,
  IndexingRule,
  IndexingRuleAttributes,
  MultiNetworks,
  Network,
  sequentialTimerMap,
} from '@graphprotocol/indexer-common'
import { parseIndexingRule } from '../rules'
import groupBy from 'lodash.groupby'
import { extractNetwork } from './resolvers/utils'
import { IndexingRuleCreationAttributes } from './models'

export class RulesManager {
  declare multiNetworks: MultiNetworks<Network>
  declare models: IndexerManagementModels
  declare logger: Logger

  static async create(
    multiNetworks: MultiNetworks<Network>,
    logger: Logger,
    models: IndexerManagementModels,
  ) {
    const rulesManager = new RulesManager()
    rulesManager.multiNetworks = multiNetworks
    rulesManager.logger = logger
    rulesManager.models = models

    logger.info('Begin monitoring indexing rules for invalid allocation lifetimes')
    await rulesManager.monitorRules()

    return rulesManager
  }

  async monitorRules(): Promise<void> {
    const logger = this.logger.child({ component: 'RulesMonitor' })
    const rules: Eventual<IndexingRuleAttributes[]> = sequentialTimerMap(
      {
        logger,
        milliseconds: 30_000,
      },
      async () => {
        logger.trace('Fetching indexing rules')
        let rules: IndexingRuleAttributes[] = []
        try {
          rules = await fetchIndexingRules(this.models, true)
          logger.trace(`Fetched ${rules.length} indexing rules`)
        } catch (err) {
          logger.warn('Failed to fetch indexing rules', { err })
        }

        return rules
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (err: any) => logger.warn('Failed to fetch indexing rules', { err }),
      },
    )

    join({ rules }).pipe(async ({ rules }) => {
      logger.info(`Indexing rules found, evaluating allocation lifetime`)
      for (const rule of rules) {
        const network = extractNetwork(rule.protocolNetwork, this.multiNetworks)
        const [isValid, maxSuggestedLifetime] = await ensureAllocationLifetime(
          rule,
          network,
        )
        if (!isValid) {
          logger.warn(`Invalid rule allocation lifetime. Indexing rewards at risk!`, {
            maxLifetime: maxSuggestedLifetime,
            ruleId: rule.id,
            ruleIdentifier: rule.identifier,
            ruleAllocationAmount: rule.allocationAmount,
            ruleAllocationLifetime: rule.allocationLifetime,
          })
        }
      }
    })
  }
}

export const fetchIndexingRules = async (
  models: IndexerManagementModels,
  merged: boolean,
  protocolNetwork?: string,
): Promise<IndexingRuleAttributes[]> => {
  // If unspecified, select indexing rules from all protocol networks
  const whereClause = protocolNetwork ? { protocolNetwork } : {}
  const rules = await models.IndexingRule.findAll({
    where: whereClause,
    order: [
      ['identifierType', 'DESC'],
      ['identifier', 'ASC'],
    ],
  })
  if (merged) {
    // Merge rules by protocol network
    return Object.entries(groupBy(rules, (rule) => rule.protocolNetwork))
      .map(([protocolNetwork, rules]) => {
        const global = rules.find((rule) => rule.identifier === INDEXING_RULE_GLOBAL)
        if (!global) {
          throw Error(`Could not find global rule for network '${protocolNetwork}'`)
        }
        return rules.map((rule) => rule.mergeGlobal(global))
      })
      .flat()
  } else {
    return rules
  }
}

export const upsertIndexingRule = async (
  logger: Logger,
  models: IndexerManagementModels,
  newRule: Partial<IndexingRuleAttributes>,
): Promise<IndexingRule> => {
  const indexingRule = parseIndexingRule(newRule)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [updatedRule, _created] = await models.IndexingRule.upsert(indexingRule)

  logger.debug(
    `DecisionBasis.${indexingRule.decisionBasis} rule merged into indexing rules`,
    {
      rule: updatedRule,
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return updatedRule!
}

// Enforce max allocation lifetime for Horizon
// This is to prevent indexing rewards from being automatically forefited due to a too long allocation lifetime
// Previously this was not enforced onchain, but anyone could force close expired allocations
export const ensureAllocationLifetime = async (
  rule: IndexingRuleAttributes | IndexingRuleCreationAttributes,
  network: Network,
): Promise<[boolean, number]> => {
  if (rule.allocationLifetime) {
    const maxAllocationDuration = await network.networkMonitor.maxAllocationDuration()
    const isHorizon = await network.isHorizon.value()

    if (isHorizon) {
      // Don't enforce for altruistic allocations
      if (
        rule.allocationLifetime > maxAllocationDuration.horizon &&
        (rule.allocationAmount === undefined ||
          rule.allocationAmount === null ||
          Number(rule.allocationAmount) > 0)
      ) {
        return [false, maxAllocationDuration.horizon]
      }
    }
  }

  return [true, 0]
}
