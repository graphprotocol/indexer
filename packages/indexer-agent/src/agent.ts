/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  join,
  Logger,
  Metrics,
  SubgraphDeploymentID,
  timer,
  toAddress,
  formatGRT,
} from '@graphprotocol/common-ts'
import {
  Action,
  ActionInput,
  ActionItem,
  ActionStatus,
  ActionType,
  ActionFilter,
  ActionResult,
  Allocation,
  AllocationManagementMode,
  allocationRewardsPool,
  AllocationStatus,
  indexerError,
  IndexerErrorCode,
  IndexingDecisionBasis,
  IndexerManagementClient,
  IndexingRuleAttributes,
  INDEXING_RULE_GLOBAL,
  Network,
  POIDisputeAttributes,
  RewardsPool,
  Subgraph,
  SubgraphIdentifierType,
  evaluateDeployments,
  AllocationDecision,
} from '@graphprotocol/indexer-common'
import { BigNumber, utils } from 'ethers'
import gql from 'graphql-tag'
import { CombinedError } from '@urql/core'
import { GraphNode } from './indexer'
import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'

const deploymentInList = (
  list: SubgraphDeploymentID[],
  deployment: SubgraphDeploymentID,
): boolean =>
  list.find(item => item.bytes32 === deployment.bytes32) !== undefined

const deploymentRuleInList = (
  list: IndexingRuleAttributes[],
  deployment: SubgraphDeploymentID,
): boolean =>
  list.find(
    rule =>
      rule.identifierType == SubgraphIdentifierType.DEPLOYMENT &&
      new SubgraphDeploymentID(rule.identifier).toString() ==
        deployment.toString(),
  ) !== undefined

const uniqueDeploymentsOnly = (
  value: SubgraphDeploymentID,
  index: number,
  array: SubgraphDeploymentID[],
): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

const uniqueDeployments = (
  deployments: SubgraphDeploymentID[],
): SubgraphDeploymentID[] => deployments.filter(uniqueDeploymentsOnly)

export const convertSubgraphBasedRulesToDeploymentBased = (
  rules: IndexingRuleAttributes[],
  subgraphs: Subgraph[],
  previousVersionBuffer: number,
): IndexingRuleAttributes[] => {
  const toAdd: IndexingRuleAttributes[] = []
  rules.map(rule => {
    if (rule.identifierType !== SubgraphIdentifierType.SUBGRAPH) {
      return rule
    }
    const ruleSubgraph = subgraphs.find(
      subgraph => subgraph.id == rule.identifier,
    )
    if (ruleSubgraph) {
      const latestVersion = ruleSubgraph.versionCount - 1
      const latestDeploymentVersion = ruleSubgraph.versions.find(
        version => version.version == latestVersion,
      )
      if (latestDeploymentVersion) {
        if (!deploymentRuleInList(rules, latestDeploymentVersion!.deployment)) {
          rule.identifier = latestDeploymentVersion!.deployment.toString()
          rule.identifierType = SubgraphIdentifierType.DEPLOYMENT
        }

        const currentTimestamp = Math.floor(Date.now() / 1000)
        if (
          latestDeploymentVersion.createdAt >
          currentTimestamp - previousVersionBuffer
        ) {
          const previousDeploymentVersion = ruleSubgraph.versions.find(
            version => version.version == latestVersion - 1,
          )
          if (
            previousDeploymentVersion &&
            !deploymentRuleInList(rules, previousDeploymentVersion.deployment)
          ) {
            const previousDeploymentRule = { ...rule }
            previousDeploymentRule.identifier =
              previousDeploymentVersion!.deployment.toString()
            previousDeploymentRule.identifierType =
              SubgraphIdentifierType.DEPLOYMENT
            toAdd.push(previousDeploymentRule)
          }
        }
      }
    }
    return rule
  })
  rules.push(...toAdd)
  return rules
}

const deploymentIDSet = (deployments: SubgraphDeploymentID[]): Set<string> =>
  new Set(deployments.map(id => id.bytes32))

export class Agent {
  logger: Logger
  metrics: Metrics
  graphNode: GraphNode
  network: Network
  indexerManagement: IndexerManagementClient
  offchainSubgraphs: SubgraphDeploymentID[]

  constructor(
    logger: Logger,
    metrics: Metrics,
    graphNode: GraphNode,
    indexerManagement: IndexerManagementClient,
    network: Network,
    offchainSubgraphs: SubgraphDeploymentID[],
  ) {
    this.logger = logger.child({ component: 'Agent' })
    this.metrics = metrics
    this.graphNode = graphNode
    this.indexerManagement = indexerManagement
    this.network = network
    this.offchainSubgraphs = offchainSubgraphs
  }

  async start(): Promise<Agent> {
    // --------------------------------------------------------------------------------
    // * Connect to Graph Node
    // --------------------------------------------------------------------------------
    this.logger.info(`Connect to Graph node(s)`)
    await this.graphNode.connect()
    this.logger.info(`Connected to Graph node(s)`)

    // --------------------------------------------------------------------------------
    // * Ensure there is a 'global' indexing rule
    // --------------------------------------------------------------------------------
    await this.ensureGlobalIndexingRule()

    // --------------------------------------------------------------------------------
    // * Register the Indexer in the Network
    // --------------------------------------------------------------------------------
    if (this.network.specification.indexerOptions.register) {
      await this.network.register()
    }

    this.buildEventualTree()
    return this
  }

  buildEventualTree() {
    const currentEpochNumber = timer(600_000).tryMap(
      async () => this.network.networkMonitor.currentEpochNumber(),
      {
        onError: error =>
          this.logger.warn(`Failed to fetch current epoch`, { error }),
      },
    )

    const channelDisputeEpochs = timer(600_000).tryMap(
      () => this.network.contracts.staking.channelDisputeEpochs(),
      {
        onError: error =>
          this.logger.warn(`Failed to fetch channel dispute epochs`, { error }),
      },
    )

    const maxAllocationEpochs = timer(600_000).tryMap(
      () => this.network.contracts.staking.maxAllocationEpochs(),
      {
        onError: error =>
          this.logger.warn(`Failed to fetch max allocation epochs`, { error }),
      },
    )

    const indexingRules = timer(20_000).tryMap(
      async () => {
        let rules = await this.indexingRules(true)
        const subgraphRuleIds = rules
          .filter(
            rule => rule.identifierType == SubgraphIdentifierType.SUBGRAPH,
          )
          .map(rule => rule.identifier!)
        const subgraphsMatchingRules =
          await this.network.networkMonitor.subgraphs(subgraphRuleIds)
        if (subgraphsMatchingRules.length >= 1) {
          const epochLength =
            await this.network.contracts.epochManager.epochLength()
          const blockPeriod = 15
          const bufferPeriod = epochLength.toNumber() * blockPeriod * 100 // 100 epochs
          rules = convertSubgraphBasedRulesToDeploymentBased(
            rules,
            subgraphsMatchingRules,
            bufferPeriod,
          )
        }
        return rules
      },
      {
        onError: error =>
          this.logger.warn(
            `Failed to obtain indexing rules, trying again later`,
            { error },
          ),
      },
    )

    const activeDeployments = timer(60_000).tryMap(
      () => this.graphNode.subgraphDeployments(),
      {
        onError: error =>
          this.logger.warn(
            `Failed to obtain active deployments, trying again later`,
            {
              error,
            },
          ),
      },
    )

    const networkDeployments = timer(240_000).tryMap(
      async () => await this.network.networkMonitor.subgraphDeployments(),
      {
        onError: error =>
          this.logger.warn(
            `Failed to obtain network deployments, trying again later`,
            {
              error,
            },
          ),
      },
    )

    const networkDeploymentAllocationDecisions = join({
      networkDeployments,
      indexingRules,
    }).tryMap(
      ({ indexingRules, networkDeployments }) => {
        // Identify subgraph deployments on the network that are worth picking up;
        // these may overlap with the ones we're already indexing
        return indexingRules.length === 0
          ? []
          : evaluateDeployments(this.logger, networkDeployments, indexingRules)
      },
      {
        onError: error =>
          this.logger.warn(
            `Failed to obtain target allocations, trying again later`,
            {
              error,
            },
          ),
      },
    )

    // let targetDeployments be an union of targetAllocations
    // and offchain subgraphs.
    const targetDeployments = join({
      ticker: timer(120_000),
      indexingRules,
      networkDeploymentAllocationDecisions,
    }).tryMap(
      async ({ indexingRules, networkDeploymentAllocationDecisions }) => {
        const rules = indexingRules
        const targetDeploymentIDs = new Set(
          networkDeploymentAllocationDecisions
            .filter(decision => decision.toAllocate === true)
            .map(decision => decision.deployment),
        )

        // add offchain subgraphs to the deployment list
        // from rules
        rules
          .filter(
            rule => rule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN,
          )
          .map(rule => {
            targetDeploymentIDs.add(new SubgraphDeploymentID(rule.identifier))
          })
        // from startup args
        this.offchainSubgraphs.map(deployment => {
          targetDeploymentIDs.add(deployment)
        })
        return [...targetDeploymentIDs]
      },
      {
        onError: error =>
          this.logger.warn(
            `Failed to obtain target deployments, trying again later`,
            {
              error,
            },
          ),
      },
    )

    const activeAllocations = timer(120_000).tryMap(
      () => this.network.networkMonitor.allocations(AllocationStatus.ACTIVE),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain active allocations, trying again later`,
          ),
      },
    )

    const recentlyClosedAllocations = join({
      activeAllocations,
      currentEpochNumber,
    }).tryMap(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ activeAllocations: _, currentEpochNumber }) =>
        this.network.networkMonitor.recentlyClosedAllocations(
          currentEpochNumber,
          1, //TODO: Parameterize with a user provided value
        ),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain active allocations, trying again later`,
          ),
      },
    )

    const claimableAllocations = join({
      currentEpochNumber,
      channelDisputeEpochs,
    }).tryMap(
      ({ currentEpochNumber, channelDisputeEpochs }) =>
        this.network.networkMonitor.claimableAllocations(
          currentEpochNumber - channelDisputeEpochs,
        ),
      {
        onError: () =>
          this.logger.warn(
            `Failed to obtain claimable allocations, trying again later`,
          ),
      },
    )
    this.logger.info(`Waiting for network data before reconciling every 120s`)

    const disputableAllocations = join({
      currentEpochNumber,
      activeDeployments,
    }).tryMap(
      ({ currentEpochNumber, activeDeployments }) =>
        this.network.networkMonitor.disputableAllocations(
          currentEpochNumber,
          activeDeployments,
          0,
        ),
      {
        onError: () =>
          this.logger.warn(
            `Failed to fetch disputable allocations, trying again later`,
          ),
      },
    )

    join({
      ticker: timer(240_000),
      paused: this.network.transactionManager.paused,
      isOperator: this.network.transactionManager.isOperator,
      currentEpochNumber,
      maxAllocationEpochs,
      activeDeployments,
      targetDeployments,
      activeAllocations,
      networkDeploymentAllocationDecisions,
      recentlyClosedAllocations,
      claimableAllocations,
      disputableAllocations,
    }).pipe(
      async ({
        paused,
        isOperator,
        currentEpochNumber,
        maxAllocationEpochs,
        activeDeployments,
        targetDeployments,
        activeAllocations,
        networkDeploymentAllocationDecisions,
        recentlyClosedAllocations,
        claimableAllocations,
        disputableAllocations,
      }) => {
        this.logger.info(`Reconcile with the network`, {
          currentEpochNumber,
        })

        // Do nothing else if the network is paused
        if (paused) {
          return this.logger.info(
            `The network is currently paused, not doing anything until it resumes`,
          )
        }

        // Do nothing if we're not authorized as an operator for the indexer
        if (!isOperator) {
          return this.logger.error(
            `Not authorized as an operator for the indexer`,
            {
              err: indexerError(IndexerErrorCode.IE034),
              indexer: toAddress(
                this.network.specification.indexerOptions.address,
              ),
              operator: toAddress(
                this.network.transactionManager.wallet.address,
              ),
            },
          )
        }

        // Do nothing if there are already approved actions in the queue awaiting execution
        const approvedActions = await this.fetchActions({
          status: ActionStatus.APPROVED,
        })
        if (approvedActions.length > 0) {
          return this.logger.info(
            `There are ${approvedActions.length} approved actions awaiting execution, will reconcile with the network once they are executed`,
          )
        }

        // Claim rebate pool rewards from finalized allocations
        try {
          await this.claimRebateRewards(claimableAllocations)
        } catch (err) {
          this.logger.warn(`Failed to claim rebate rewards`, { err })
        }

        try {
          const disputableEpoch =
            currentEpochNumber -
            this.network.specification.indexerOptions.poiDisputableEpochs
          // Find disputable allocations
          await this.identifyPotentialDisputes(
            disputableAllocations,
            disputableEpoch,
          )
        } catch (err) {
          this.logger.warn(`Failed POI dispute monitoring`, { err })
        }

        try {
          await this.reconcileDeployments(
            activeDeployments,
            targetDeployments,
            [...recentlyClosedAllocations, ...activeAllocations],
          )

          // Reconcile allocation actions
          await this.reconcileActions(
            networkDeploymentAllocationDecisions,
            activeAllocations,
            currentEpochNumber,
            maxAllocationEpochs,
          )
        } catch (err) {
          this.logger.warn(
            `Exited early while reconciling deployments/allocations`,
            {
              err: indexerError(IndexerErrorCode.IE005, err),
            },
          )
        }
      },
    )
  }

  async indexingRules(merged: boolean): Promise<IndexingRuleAttributes[]> {
    try {
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
    try {
      const globalRule = await this.indexerManagement
        .query(
          gql`
            query indexingRule($identifier: String!) {
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
          { identifier: INDEXING_RULE_GLOBAL },
        )
        .toPromise()

      if (!globalRule.data.indexingRule) {
        this.logger.info(`Creating default "global" indexing rule`)

        const defaults = {
          identifier: INDEXING_RULE_GLOBAL,
          identifierType: SubgraphIdentifierType.GROUP,
          allocationAmount:
            // TODO:L2: Perform this procedure for all configured networks, not just one
            this.network.specification.indexerOptions.defaultAllocationAmount.toString(),
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

  async claimRebateRewards(allocations: Allocation[]): Promise<void> {
    if (allocations.length > 0) {
      this.logger.info(`Claim rebate rewards`, {
        claimable: allocations.map(allocation => ({
          id: allocation.id,
          deployment: allocation.subgraphDeployment.id.display,
          createdAtEpoch: allocation.createdAtEpoch,
          amount: allocation.queryFeeRebates,
        })),
      })
      await this.network.claimMany(allocations)
    }
  }

  async identifyPotentialDisputes(
    disputableAllocations: Allocation[],
    disputableEpoch: number,
  ): Promise<void> {
    // TODO: Support supplying status = 'any' to fetchPOIDisputes() to fetch all previously processed allocations in a single query

    // TODO:L2: Perform this procedure for all configured networks, not just one
    const protocolNetwork = this.network.networkMonitor.networkCAIPID

    const alreadyProcessed = (
      await this.fetchPOIDisputes('potential', disputableEpoch, protocolNetwork)
    ).concat(
      await this.fetchPOIDisputes('valid', disputableEpoch, protocolNetwork),
    )

    const newDisputableAllocations = disputableAllocations.filter(
      allocation =>
        !alreadyProcessed.find(
          dispute => dispute.allocationID == allocation.id,
        ),
    )
    if (newDisputableAllocations.length == 0) {
      this.logger.trace(
        'No new disputable allocations to process for potential disputes',
      )
      return
    }

    this.logger.debug(
      `Found new allocations onchain for subgraphs we have indexed. Let's compare POIs to identify any potential indexing disputes`,
    )

    const uniqueRewardsPools: RewardsPool[] = await Promise.all(
      [
        ...new Set(
          newDisputableAllocations.map(allocation =>
            allocationRewardsPool(allocation),
          ),
        ),
      ]
        .filter(pool => pool.closedAtEpochStartBlockHash)
        .map(async pool => {
          const closedAtEpochStartBlock =
            await this.network.networkProvider.getBlock(
              pool.closedAtEpochStartBlockHash!,
            )

          // Todo: Lazily fetch this, only if the first reference POI doesn't match
          const previousEpochStartBlock =
            await this.network.networkProvider.getBlock(
              pool.previousEpochStartBlockHash!,
            )
          pool.closedAtEpochStartBlockNumber = closedAtEpochStartBlock.number
          pool.referencePOI =
            await this.graphNode.statusResolver.proofOfIndexing(
              pool.subgraphDeployment,
              {
                number: closedAtEpochStartBlock.number,
                hash: closedAtEpochStartBlock.hash,
              },
              pool.allocationIndexer,
            )
          pool.previousEpochStartBlockHash = previousEpochStartBlock.hash
          pool.previousEpochStartBlockNumber = previousEpochStartBlock.number
          pool.referencePreviousPOI =
            await this.graphNode.statusResolver.proofOfIndexing(
              pool.subgraphDeployment,
              {
                number: previousEpochStartBlock.number,
                hash: previousEpochStartBlock.hash,
              },
              pool.allocationIndexer,
            )
          return pool
        }),
    )

    const disputes: POIDisputeAttributes[] = newDisputableAllocations.map(
      (allocation: Allocation) => {
        const rewardsPool = uniqueRewardsPools.find(
          pool =>
            pool.subgraphDeployment == allocation.subgraphDeployment.id &&
            pool.closedAtEpoch == allocation.closedAtEpoch,
        )
        if (!rewardsPool) {
          throw Error(
            `No rewards pool found for deployment ${allocation.subgraphDeployment.id}`,
          )
        }

        let status =
          rewardsPool!.referencePOI == allocation.poi ||
          rewardsPool!.referencePreviousPOI == allocation.poi
            ? 'valid'
            : 'potential'

        if (
          status === 'potential' &&
          (!rewardsPool.referencePOI || !rewardsPool.referencePreviousPOI)
        ) {
          status = 'reference_unavailable'
        }

        return {
          allocationID: allocation.id,
          subgraphDeploymentID: allocation.subgraphDeployment.id.ipfsHash,
          allocationIndexer: allocation.indexer,
          allocationAmount: allocation.allocatedTokens.toString(),
          allocationProof: allocation.poi!,
          closedEpoch: allocation.closedAtEpoch,
          closedEpochReferenceProof: rewardsPool!.referencePOI,
          closedEpochStartBlockHash: allocation.closedAtEpochStartBlockHash!,
          closedEpochStartBlockNumber:
            rewardsPool!.closedAtEpochStartBlockNumber!,
          previousEpochReferenceProof: rewardsPool!.referencePreviousPOI,
          previousEpochStartBlockHash:
            rewardsPool!.previousEpochStartBlockHash!,
          previousEpochStartBlockNumber:
            rewardsPool!.previousEpochStartBlockNumber!,
          status,
          protocolNetwork,
        } as POIDisputeAttributes
      },
    )

    const potentialDisputes = disputes.filter(
      dispute => dispute.status == 'potential',
    ).length
    const stored = await this.storePoiDisputes(disputes)

    this.logger.info(`Disputable allocations' POIs validated`, {
      potentialDisputes: potentialDisputes,
      validAllocations: stored.length - potentialDisputes,
    })
  }

  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
    eligibleAllocations: Allocation[],
  ): Promise<void> {
    activeDeployments = uniqueDeployments(activeDeployments)
    targetDeployments = uniqueDeployments(targetDeployments)
    // Note eligibleAllocations are active or recently closed allocations still eligible for queries from the gateway
    const eligibleAllocationDeployments = uniqueDeployments(
      eligibleAllocations.map(allocation => allocation.subgraphDeployment.id),
    )

    // Ensure the network subgraph deployment is _always_ indexed
    if (this.network.networkSubgraph.deployment) {
      if (
        !deploymentInList(
          targetDeployments,
          this.network.networkSubgraph.deployment.id,
        )
      ) {
        targetDeployments.push(this.network.networkSubgraph.deployment.id)
      }
    }

    // Ensure all subgraphs in offchain subgraphs list are _always_ indexed
    for (const offchainSubgraph of this.offchainSubgraphs) {
      if (!deploymentInList(targetDeployments, offchainSubgraph)) {
        targetDeployments.push(offchainSubgraph)
      }
    }

    // only show Reconcile when active ids != target ids
    // TODO: Fix this check, always returning true
    if (
      deploymentIDSet(activeDeployments) != deploymentIDSet(targetDeployments)
    ) {
      // Turning to trace until the above conditional is fixed
      this.logger.debug('Reconcile deployments', {
        syncing: activeDeployments.map(id => id.display),
        target: targetDeployments.map(id => id.display),
        withActiveOrRecentlyClosedAllocation: eligibleAllocationDeployments.map(
          id => id.display,
        ),
      })
    }

    // Identify which subgraphs to deploy and which to remove
    const deploy = targetDeployments.filter(
      deployment => !deploymentInList(activeDeployments, deployment),
    )
    const remove = activeDeployments.filter(
      deployment =>
        !deploymentInList(targetDeployments, deployment) &&
        !deploymentInList(eligibleAllocationDeployments, deployment),
    )

    if (deploy.length + remove.length !== 0) {
      this.logger.info('Deployment changes', {
        deploy: deploy.map(id => id.display),
        remove: remove.map(id => id.display),
      })
    }

    // Deploy/remove up to 10 subgraphs in parallel
    const queue = new PQueue({ concurrency: 10 })

    // Index all new deployments worth indexing
    await queue.addAll(
      deploy.map(deployment => async () => {
        const name = `indexer-agent/${deployment.ipfsHash.slice(-10)}`

        this.logger.info(`Index subgraph deployment`, {
          name,
          deployment: deployment.display,
        })

        // Ensure the deployment is deployed to the indexer
        // Note: we're not waiting here, as sometimes indexing a subgraph
        // will block if the IPFS files cannot be retrieved
        this.graphNode.ensure(name, deployment)
      }),
    )

    // Stop indexing deployments that are no longer worth indexing
    await queue.addAll(
      remove.map(deployment => async () => this.graphNode.remove(deployment)),
    )

    await queue.onIdle()
  }

  async identifyExpiringAllocations(
    _logger: Logger,
    activeAllocations: Allocation[],
    deploymentAllocationDecision: AllocationDecision,
    epoch: number,
    maxAllocationEpochs: number,
  ): Promise<Allocation[]> {
    const desiredAllocationLifetime = deploymentAllocationDecision.ruleMatch
      .rule?.allocationLifetime
      ? deploymentAllocationDecision.ruleMatch.rule.allocationLifetime
      : Math.max(1, maxAllocationEpochs - 1)

    // Identify expiring allocations
    let expiredAllocations = activeAllocations.filter(
      allocation =>
        epoch >= allocation.createdAtEpoch + desiredAllocationLifetime,
    )
    // The allocations come from the network subgraph; due to short indexing
    // latencies, this data may be slightly outdated. Cross-check with the
    // contracts to avoid closing allocations that are already closed on
    // chain.
    expiredAllocations = await pFilter(
      expiredAllocations,
      async (allocation: Allocation) => {
        try {
          const onChainAllocation =
            await this.network.contracts.staking.getAllocation(allocation.id)
          return onChainAllocation.closedAtEpoch.eq('0')
        } catch (err) {
          this.logger.warn(
            `Failed to cross-check allocation state with contracts; assuming it needs to be closed`,
            {
              deployment: deploymentAllocationDecision.deployment.ipfsHash,
              allocation: allocation.id,
              err: indexerError(IndexerErrorCode.IE006, err),
            },
          )
          return true
        }
      },
    )
    return expiredAllocations
  }

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
    switch (
      // TODO:L2: Perform this procedure for all configured networks, not just one
      this.network.specification.indexerOptions.allocationManagementMode
    ) {
      case AllocationManagementMode.MANUAL:
        throw Error(
          `Cannot queue actions when AllocationManagementMode = 'MANUAL'`,
        )
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
    } as ActionInput

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
            }
          }
        `,
        { actions: [actionInput] },
      )
      .toPromise()

    if (actionResult.error) {
      if (
        actionResult.error instanceof CombinedError &&
        actionResult.error.message.includes('Duplicate')
      ) {
        this.logger.warn(
          `Action not queued: Already a queued action targeting ${actionInput.deploymentID} from another source`,
          { action },
        )
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

  // TODO:L2: This procedure is network-specific. Put this method in the Network class
  async createAllocation(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    mostRecentlyClosedAllocation: Allocation,
  ): Promise<void> {
    const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch.rule
      ?.allocationAmount
      ? BigNumber.from(
          deploymentAllocationDecision.ruleMatch.rule.allocationAmount,
        )
      : // TODO:L2: Perform this procedure for all configured networks, not just one
        this.network.specification.indexerOptions.defaultAllocationAmount

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

  // TODO:L2: This procedure is network-specific. Put this method in the Network class
  async closeEligibleAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    activeDeploymentAllocations: Allocation[],
    epoch: number,
  ): Promise<void> {
    const activeDeploymentAllocationsEligibleForClose =
      activeDeploymentAllocations
        .filter(allocation => allocation.createdAtEpoch < epoch)
        .map(allocation => allocation.id)
    // Make sure to close all active allocations on the way out
    if (activeDeploymentAllocationsEligibleForClose.length > 0) {
      logger.info(
        `Deployment is not (or no longer) worth allocating towards, close allocation`,
        {
          eligibleForClose: activeDeploymentAllocationsEligibleForClose,
        },
      )
      await pMap(
        // We can only close allocations from a previous epoch;
        // try the others again later
        activeDeploymentAllocationsEligibleForClose,
        async allocation => {
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

  async reconcileDeploymentAllocationAction(
    deploymentAllocationDecision: AllocationDecision,
    epoch: number,
    maxAllocationEpochs: number,
  ): Promise<void> {
    const logger = this.logger.child({
      deployment: deploymentAllocationDecision.deployment.ipfsHash,
      epoch,
    })

    // Acuracy check: re-fetch allocations to ensure that we have a fresh state since the start of the reconciliation loop
    const activeAllocations = await this.network.networkMonitor.allocations(
      AllocationStatus.ACTIVE,
    )

    const activeDeploymentAllocations = activeAllocations.filter(
      allocation =>
        allocation.subgraphDeployment.id.bytes32 ===
        deploymentAllocationDecision.deployment.bytes32,
    )

    switch (deploymentAllocationDecision.toAllocate) {
      case false:
        return await this.closeEligibleAllocations(
          logger,
          deploymentAllocationDecision,
          activeDeploymentAllocations,
          epoch,
        )
      case true: {
        // If no active allocations, create one
        if (activeDeploymentAllocations.length === 0) {
          return await this.createAllocation(
            logger,
            deploymentAllocationDecision,
            (
              await this.network.networkMonitor.closedAllocations(
                deploymentAllocationDecision.deployment,
              )
            )[0],
          )
        }

        // Refresh any expiring allocations
        const expiringAllocations = await this.identifyExpiringAllocations(
          logger,
          activeDeploymentAllocations,
          deploymentAllocationDecision,
          epoch,
          maxAllocationEpochs,
        )
        if (expiringAllocations.length > 0) {
          await this.refreshExpiredAllocations(
            logger,
            deploymentAllocationDecision,
            expiringAllocations,
          )
        }
      }
    }
  }

  // TODO:L2: This procedure is network-specific. Put this method in the Network class
  async refreshExpiredAllocations(
    logger: Logger,
    deploymentAllocationDecision: AllocationDecision,
    expiredAllocations: Allocation[],
  ): Promise<void> {
    if (deploymentAllocationDecision.ruleMatch.rule?.autoRenewal) {
      logger.info(`Reallocating expired allocations`, {
        number: expiredAllocations.length,
        expiredAllocations: expiredAllocations.map(allocation => allocation.id),
      })

      const desiredAllocationAmount = deploymentAllocationDecision.ruleMatch
        .rule?.allocationAmount
        ? BigNumber.from(
            deploymentAllocationDecision.ruleMatch.rule.allocationAmount,
          )
        : // TODO:L2: Perform this procedure for all configured networks, not just one
          this.network.specification.indexerOptions.defaultAllocationAmount

      // Queue reallocate actions to be picked up by the worker
      await pMap(expiredAllocations, async allocation => {
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
      })
    } else {
      logger.info(
        `Skipping reallocating expired allocation since the corresponding rule has 'autoRenewal' = False`,
        {
          number: expiredAllocations.length,
          expiredAllocations: expiredAllocations.map(
            allocation => allocation.id,
          ),
        },
      )
    }
    return
  }

  // TODO:L2: This procedure is network-specific. Put this method in the Network class
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

  // TODO:L2: This procedure is network-specific. Put this method in the Network class
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
              $protocolNetwork: String
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
      this.logger.error('Failed to store potential POI disputes', {
        err,
      })
      throw err
    }
  }

  async reconcileActions(
    networkDeploymentAllocationDecisions: AllocationDecision[],
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
  ): Promise<void> {
    if (
      // TODO:L2: Perform this procedure for all configured networks, not just one
      this.network.specification.indexerOptions.allocationManagementMode ==
      AllocationManagementMode.MANUAL
    ) {
      this.logger.trace(
        `Skipping allocation reconciliation since AllocationManagementMode = 'manual'`,
        {
          activeAllocations,
          targetDeployments: networkDeploymentAllocationDecisions
            .filter(decision => decision.toAllocate)
            .map(decision => decision.deployment.ipfsHash),
        },
      )
      return
    }

    // Ensure the network subgraph is never allocated towards
    if (
      !this.network.specification.indexerOptions.allocateOnNetworkSubgraph &&
      this.network.networkSubgraph.deployment?.id.bytes32
    ) {
      const networkSubgraphDeploymentId =
        this.network.networkSubgraph.deployment.id
      const networkSubgraphIndex =
        networkDeploymentAllocationDecisions.findIndex(
          decision =>
            decision.deployment.bytes32 == networkSubgraphDeploymentId.bytes32,
        )
      if (networkSubgraphIndex >= 0) {
        networkDeploymentAllocationDecisions[networkSubgraphIndex].toAllocate =
          false
      }
    }

    this.logger.trace(`Reconcile allocation actions`, {
      epoch,
      maxAllocationEpochs,
      targetDeployments: networkDeploymentAllocationDecisions
        .filter(decision => decision.toAllocate)
        .map(decision => decision.deployment.ipfsHash),
      activeAllocations: activeAllocations.map(allocation => ({
        id: allocation.id,
        deployment: allocation.subgraphDeployment.id.ipfsHash,
        createdAtEpoch: allocation.createdAtEpoch,
      })),
    })

    // Loop through all deployments on network and queue allocation actions if needed
    await pMap(networkDeploymentAllocationDecisions, async decision => {
      await this.reconcileDeploymentAllocationAction(
        decision,
        epoch,
        maxAllocationEpochs,
      )
    })
  }
}

// --------------------------------------------------------------------------------
// * DISPUTES
// --------------------------------------------------------------------------------
const POI_DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | BigNumber | number | null
> = {
  allocationID: x => x,
  subgraphDeploymentID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => x,
  allocationProof: x => x,
  closedEpoch: x => +x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => +x,
  closedEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => +x,
  previousEpochReferenceProof: x => x,
  status: x => x,
  protocolNetwork: x => x,
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
