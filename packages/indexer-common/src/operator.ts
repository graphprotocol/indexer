import {
  ActionFilter,
  ActionItem,
  ActionResult,
  ActionStatus,
  ActionType,
  Allocation,
  AllocationDecision,
  AllocationManagementMode,
  INDEXING_RULE_GLOBAL,
  IndexerErrorCode,
  IndexerManagementClient,
  IndexingRuleAttributes,
  SubgraphIdentifierType,
  indexerError,
  specification as spec,
  Action,
  POIDisputeAttributes,
} from '@graphprotocol/indexer-common'
import { Logger, formatGRT } from '@graphprotocol/common-ts'
import { BigNumber, utils } from 'ethers'
import gql from 'graphql-tag'
import pMap from 'p-map'
import { CombinedError } from '@urql/core'

const POI_DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | BigNumber | number | null
> = {
  allocationID: (x) => x,
  subgraphDeploymentID: (x) => x,
  allocationIndexer: (x) => x,
  allocationAmount: (x) => x,
  allocationProof: (x) => x,
  closedEpoch: (x) => +x,
  closedEpochStartBlockHash: (x) => x,
  closedEpochStartBlockNumber: (x) => +x,
  closedEpochReferenceProof: (x) => x,
  previousEpochStartBlockHash: (x) => x,
  previousEpochStartBlockNumber: (x) => +x,
  previousEpochReferenceProof: (x) => x,
  status: (x) => x,
  protocolNetwork: (x) => x,
}

/**
 * Parses a POI dispute returned from the indexer management GraphQL
 * API into normalized form.
 */
const disputeFromGraphQL = (
  dispute: Partial<POIDisputeAttributes>,
): POIDisputeAttributes => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(dispute)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (POI_DISPUTES_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as POIDisputeAttributes
}

// This component is responsible for managing indexing rules, actions, allocations, and
// POI disputes.
export class Operator {
  logger: Logger
  indexerManagement: IndexerManagementClient
  specification: spec.NetworkSpecification

  constructor(
    logger: Logger,
    indexerManagement: IndexerManagementClient,
    specification: spec.NetworkSpecification,
  ) {
    this.logger = logger.child({
      component: 'Operator',
      protocolNetwork: specification.networkIdentifier,
    })
    this.indexerManagement = indexerManagement
    this.specification = specification
  }

  // --------------------------------------------------------------------------------
  // * Indexing Rules
  // --------------------------------------------------------------------------------
  // Retrieves the indexing rules from the indexer management API.
  async indexingRules(merged: boolean): Promise<IndexingRuleAttributes[]> {
    try {
      this.logger.debug('Fetching indexing rules')
      const result = await this.indexerManagement
        .query(
          gql`
            query indexingRules($merged: Boolean!) {
              indexingRules(merged: $merged) {
                identifier
                identifierType
                allocationAmount
                allocationLifetime
                autoRenewal
                parallelAllocations
                maxAllocationPercentage
                minSignal
                maxSignal
                minStake
                minAverageQueryFees
                custom
                decisionBasis
                requireSupported
                protocolNetwork
              }
            }
          `,
          { merged },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }
      this.logger.trace('Fetched indexing rules', {
        count: result.data.indexingRules.length,
        rules: result.data.indexingRules.map((rule: IndexingRuleAttributes) => {
          return {
            identifier: rule.identifier,
            identifierType: rule.identifierType,
            decisionBasis: rule.decisionBasis,
            protocolNetwork: rule.protocolNetwork,
          }
        }),
      })
      return result.data.indexingRules
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE025, error)
      this.logger.error(`Failed to query indexer management API`, { err })
      throw err
    }
  }

  async ensureGlobalIndexingRule(): Promise<void> {
    const identifier = {
      identifier: INDEXING_RULE_GLOBAL,
      protocolNetwork: this.specification.networkIdentifier,
    }
    try {
      const globalRule = await this.indexerManagement
        .query(
          gql`
            query indexingRule($identifier: IndexingRuleIdentifier!) {
              indexingRule(identifier: $identifier, merged: false) {
                identifier
                identifierType
                allocationAmount
                decisionBasis
                requireSupported
                protocolNetwork
              }
            }
          `,
          { identifier },
        )
        .toPromise()

      if (!globalRule.data.indexingRule) {
        this.logger.info(`Creating default "global" indexing rule`)

        const defaults = {
          ...identifier,
          identifierType: SubgraphIdentifierType.GROUP,
          allocationAmount:
            this.specification.indexerOptions.defaultAllocationAmount.toString(),
          parallelAllocations: 1,
          decisionBasis: 'rules',
          requireSupported: true,
          safety: true,
        }

        const defaultGlobalRule = await this.indexerManagement
          .mutation(
            gql`
              mutation setIndexingRule($rule: IndexingRuleInput!) {
                setIndexingRule(rule: $rule) {
                  identifier
                  identifierType
                  allocationAmount
                  allocationLifetime
                  autoRenewal
                  parallelAllocations
                  maxAllocationPercentage
                  minSignal
                  maxSignal
                  minStake
                  minAverageQueryFees
                  custom
                  decisionBasis
                  requireSupported
                  safety
                  protocolNetwork
                }
              }
            `,
            { rule: defaults },
          )
          .toPromise()

        if (defaultGlobalRule.error) {
          throw defaultGlobalRule.error
        }

        this.logger.info(`Created default "global" indexing rule`, {
          rule: defaultGlobalRule.data.setIndexingRule,
        })
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE017, error)
      this.logger.warn('Failed to ensure default "global" indexing rule', {
        err,
      })
      throw err
    }
  }

  // --------------------------------------------------------------------------------
  // * Actions
  // --------------------------------------------------------------------------------

  async fetchActions(actionFilter: ActionFilter): Promise<ActionResult[]> {
    const result = await this.indexerManagement
      .query(
        gql`
          query actions($filter: ActionFilter!) {
            actions(filter: $filter) {
              id
              type
              allocationID
              deploymentID
              amount
              poi
              force
              source
              reason
              priority
              transaction
              status
              failureReason
            }
          }
        `,
        { filter: actionFilter },
      )
      .toPromise()

    if (result.error) {
      throw result.error
    }

    return result.data.actions
  }

  async queueAction(action: ActionItem): Promise<Action[]> {
    let status = ActionStatus.QUEUED
    switch (this.specification.indexerOptions.allocationManagementMode) {
      case AllocationManagementMode.MANUAL:
        throw Error(`Cannot queue actions when AllocationManagementMode = 'MANUAL'`)
      case AllocationManagementMode.AUTO:
        status = ActionStatus.APPROVED
        break
      case AllocationManagementMode.OVERSIGHT:
        status = ActionStatus.QUEUED
    }

    const actionInput = {
      ...action.params,
      status,
      type: action.type,
      source: 'indexerAgent',
      reason: action.reason,
      priority: 0,
      protocolNetwork: action.protocolNetwork,
    }
    this.logger.trace(`Queueing action input`, {
      actionInput,
    })
    const actionResult = await this.indexerManagement
      .mutation(
        gql`
          mutation queueActions($actions: [ActionInput!]!) {
            queueActions(actions: $actions) {
              id
              type
              deploymentID
              source
              reason
              priority
              status
              protocolNetwork
            }
          }
        `,
        { actions: [actionInput] },
      )
      .toPromise()

    if (actionResult.error) {
      if (actionResult.error instanceof CombinedError) {
        if (actionResult.error.message.includes('Duplicate')) {
          this.logger.warn(
            `Action not queued: Already a queued action targeting ${actionInput.deploymentID} from another source`,
            { action },
          )
        } else if (actionResult.error.message.includes('Recently executed')) {
          this.logger.warn(
            `Action not queued: A recently executed action was found targeting ${actionInput.deploymentID}`,
            { action },
          )
        }
        return []
      }
      throw actionResult.error
    }

    if (actionResult.data.queueActions.length > 0) {
      this.logger.info(`Queued ${action.type} action for execution`, {
        queuedAction: actionResult.data.queueActions,
      })
    }

    return actionResult.data.queueActions
  }

  // --------------------------------------------------------------------------------
  // * Allocations
  // --------------------------------------------------------------------------------
  async createAllocation(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    mostRecentlyClosedAllocation: Allocation | undefined,
  ): Promise<void> {
    const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch.rule
      ?.allocationAmount
      ? BigNumber.from(deploymentAllocationDecision.ruleMatch.rule.allocationAmount)
      : this.specification.indexerOptions.defaultAllocationAmount

    logger.info(`No active allocation for deployment, creating one now`, {
      allocationAmount: formatGRT(desiredAllocationAmount),
    })

    // Skip allocating if the previous allocation for this deployment was closed with 0x00 POI but rules set to un-safe
    if (
      deploymentAllocationDecision.ruleMatch.rule?.safety &&
      mostRecentlyClosedAllocation &&
      mostRecentlyClosedAllocation.poi === utils.hexlify(Array(32).fill(0))
    ) {
      logger.warn(
        `Skipping allocation to this deployment as the last allocation to it was closed with a zero POI`,
        {
          notSafe: !deploymentAllocationDecision.ruleMatch.rule?.safety,
          deployment: deploymentAllocationDecision.deployment,
          closedAllocation: mostRecentlyClosedAllocation.id,
        },
      )
      return
    }

    // Send AllocateAction to the queue
    await this.queueAction({
      params: {
        deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
        amount: formatGRT(desiredAllocationAmount),
      },
      type: ActionType.ALLOCATE,
      reason: deploymentAllocationDecision.reasonString(),
      protocolNetwork: deploymentAllocationDecision.protocolNetwork,
    })

    return
  }

  async closeEligibleAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    activeDeploymentAllocations: Allocation[],
  ): Promise<void> {
    const activeDeploymentAllocationsEligibleForClose = activeDeploymentAllocations.map(
      (allocation) => allocation.id,
    )
    // Make sure to close all active allocations on the way out
    if (activeDeploymentAllocationsEligibleForClose.length > 0) {
      logger.info(
        `Deployment is not (or no longer) worth allocating towards, close allocations`,
        {
          eligibleForClose: activeDeploymentAllocationsEligibleForClose,
          reason: deploymentAllocationDecision.reasonString(),
        },
      )
      await pMap(
        // We can only close allocations from a previous epoch;
        // try the others again later
        activeDeploymentAllocationsEligibleForClose,
        async (allocation) => {
          // Send unallocate action to the queue
          await this.queueAction({
            params: {
              allocationID: allocation,
              deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
              poi: undefined,
              force: false,
            },
            type: ActionType.UNALLOCATE,
            reason: deploymentAllocationDecision.reasonString(),
            protocolNetwork: deploymentAllocationDecision.protocolNetwork,
          } as ActionItem)
        },
        { concurrency: 1 },
      )
    }
  }

  async refreshExpiredAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    expiredAllocations: Allocation[],
  ): Promise<void> {
    if (deploymentAllocationDecision.ruleMatch.rule?.autoRenewal) {
      logger.info(`Reallocating expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map((allocation) => allocation.id),
      })

      const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch.rule
        ?.allocationAmount
        ? BigNumber.from(deploymentAllocationDecision.ruleMatch.rule.allocationAmount)
        : this.specification.indexerOptions.defaultAllocationAmount

      // Queue reallocate actions to be picked up by the worker
      await pMap(
        expiredAllocations,
        async (allocation) => {
          await this.queueAction({
            params: {
              allocationID: allocation.id,
              deploymentID: deploymentAllocationDecision.deployment.ipfsHash,
              amount: formatGRT(desiredAllocationAmount),
            },
            type: ActionType.REALLOCATE,
            reason: `${deploymentAllocationDecision.reasonString()}:allocationExpiring`, // Need to update to include 'ExpiringSoon'
            protocolNetwork: deploymentAllocationDecision.protocolNetwork,
          })
        },
        {
          stopOnError: false,
          concurrency: 1,
        },
      )
    } else {
      logger.info(
        `Skipping reallocating expired allocation since the corresponding rule has 'autoRenewal' = False`,
        {
          number: expiredAllocations.length,
          expiredAllocations: expiredAllocations.map((allocation) => allocation.id),
        },
      )
    }
    return
  }
  // --------------------------------------------------------------------------------
  // POI Disputes
  // --------------------------------------------------------------------------------

  async storePoiDisputes(
    disputes: POIDisputeAttributes[],
  ): Promise<POIDisputeAttributes[]> {
    try {
      const result = await this.indexerManagement
        .mutation(
          gql`
            mutation storeDisputes($disputes: [POIDisputeInput!]!) {
              storeDisputes(disputes: $disputes) {
                allocationID
                subgraphDeploymentID
                allocationIndexer
                allocationAmount
                allocationProof
                closedEpoch
                closedEpochStartBlockHash
                closedEpochStartBlockNumber
                closedEpochReferenceProof
                previousEpochStartBlockHash
                previousEpochStartBlockNumber
                previousEpochReferenceProof
                status
                protocolNetwork
              }
            }
          `,
          { disputes: disputes },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.storeDisputes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dispute: Record<string, any>) => {
          return disputeFromGraphQL(dispute)
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE039, error)
      this.logger.error('Failed to store potential POI disputes', {
        err,
      })
      throw err
    }
  }

  async fetchPOIDisputes(
    status: string,
    minClosedEpoch: number,
    protocolNetwork: string | undefined,
  ): Promise<POIDisputeAttributes[]> {
    try {
      const result = await this.indexerManagement
        .query(
          gql`
            query disputes(
              $status: String!
              $minClosedEpoch: Int!
              $protocolNetwork: String!
            ) {
              disputes(
                status: $status
                minClosedEpoch: $minClosedEpoch
                protocolNetwork: $protocolNetwork
              ) {
                allocationID
                subgraphDeploymentID
                allocationIndexer
                allocationAmount
                allocationProof
                closedEpoch
                closedEpochStartBlockHash
                closedEpochStartBlockNumber
                closedEpochReferenceProof
                previousEpochStartBlockHash
                previousEpochStartBlockNumber
                previousEpochReferenceProof
                status
                protocolNetwork
              }
            }
          `,
          {
            status,
            minClosedEpoch,
            protocolNetwork,
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return result.data.disputes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dispute: Record<string, any>) => {
          return disputeFromGraphQL(dispute)
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE039, error)
      this.logger.error('Failed to fetch POI disputes', {
        err,
      })
      throw err
    }
  }
}
