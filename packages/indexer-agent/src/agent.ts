/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  join,
  Logger,
  Metrics,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@tokene-q/common-ts'
import {
  ActionStatus,
  Allocation,
  AllocationManagementMode,
  allocationRewardsPool,
  AllocationStatus,
  indexerError,
  IndexerErrorCode,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  NetworkMonitor,
  NetworkSubgraph,
  POIDisputeAttributes,
  ReceiptCollector,
  RewardsPool,
  Subgraph,
  SubgraphIdentifierType,
  evaluateDeployments,
  AllocationDecision,
} from '@graphprotocol/indexer-common'
import { Indexer } from './indexer'
import { AgentConfig } from './types'
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

class Agent {
  logger: Logger
  metrics: Metrics
  indexer: Indexer
  network: Network
  networkMonitor: NetworkMonitor
  networkSubgraph: NetworkSubgraph
  allocateOnNetworkSubgraph: boolean
  registerIndexer: boolean
  offchainSubgraphs: SubgraphDeploymentID[]
  receiptCollector: ReceiptCollector

  constructor(
    logger: Logger,
    metrics: Metrics,
    indexer: Indexer,
    network: Network,
    networkMonitor: NetworkMonitor,
    networkSubgraph: NetworkSubgraph,
    allocateOnNetworkSubgraph: boolean,
    registerIndexer: boolean,
    offchainSubgraphs: SubgraphDeploymentID[],
    receiptCollector: ReceiptCollector,
  ) {
    this.logger = logger.child({ component: 'Agent' })
    this.metrics = metrics
    this.indexer = indexer
    this.network = network
    this.networkMonitor = networkMonitor
    this.networkSubgraph = networkSubgraph
    this.allocateOnNetworkSubgraph = allocateOnNetworkSubgraph
    this.registerIndexer = registerIndexer
    this.offchainSubgraphs = offchainSubgraphs
    this.receiptCollector = receiptCollector
  }

  async start(): Promise<Agent> {
    this.logger.info(`Connect to Graph node(s)`)
    await this.indexer.connect()
    this.logger.info(`Connected to Graph node(s)`)

    // Ensure there is a 'global' indexing rule
    await this.indexer.ensureGlobalIndexingRule()

    if (this.registerIndexer) {
      await this.network.register()
    }

    const currentEpochNumber = timer(600_000).tryMap(
      async () => this.networkMonitor.currentEpochNumber(),
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
        let rules = await this.indexer.indexingRules(true)
        const subgraphRuleIds = rules
          .filter(
            rule => rule.identifierType == SubgraphIdentifierType.SUBGRAPH,
          )
          .map(rule => rule.identifier!)
        const subgraphsMatchingRules = await this.networkMonitor.subgraphs(
          subgraphRuleIds,
        )
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
      () => this.indexer.subgraphDeployments(),
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
      async () => await this.networkMonitor.subgraphDeployments(),
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
      () => this.networkMonitor.allocations(AllocationStatus.ACTIVE),
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
      ({ activeAllocations, currentEpochNumber }) =>
        this.networkMonitor.recentlyClosedAllocations(
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
        this.network.claimableAllocations(
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
        this.network.disputableAllocations(
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
              indexer: toAddress(this.network.indexerAddress),
              operator: toAddress(
                this.network.transactionManager.wallet.address,
              ),
            },
          )
        }

        // Do nothing if there are already approved actions in the queue awaiting execution
        const approvedActions = await this.indexer.fetchActions({
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
            currentEpochNumber - this.network.indexerConfigs.poiDisputableEpochs
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

    return this
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
    const alreadyProcessed = (
      await this.indexer.fetchPOIDisputes('potential', disputableEpoch)
    ).concat(await this.indexer.fetchPOIDisputes('valid', disputableEpoch))

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
          const closedAtEpochStartBlock = await this.network.ethereum.getBlock(
            pool.closedAtEpochStartBlockHash!,
          )

          // Todo: Lazily fetch this, only if the first reference POI doesn't match
          const previousEpochStartBlock = await this.network.ethereum.getBlock(
            pool.previousEpochStartBlockHash!,
          )
          pool.closedAtEpochStartBlockNumber = closedAtEpochStartBlock.number
          pool.referencePOI = await this.indexer.statusResolver.proofOfIndexing(
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
            await this.indexer.statusResolver.proofOfIndexing(
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
        } as POIDisputeAttributes
      },
    )

    const potentialDisputes = disputes.filter(
      dispute => dispute.status == 'potential',
    ).length
    const stored = await this.indexer.storePoiDisputes(disputes)

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
    if (this.networkSubgraph.deployment) {
      if (
        !deploymentInList(targetDeployments, this.networkSubgraph.deployment.id)
      ) {
        targetDeployments.push(this.networkSubgraph.deployment.id)
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
        this.indexer.ensure(name, deployment)
      }),
    )

    // Stop indexing deployments that are no longer worth indexing
    await queue.addAll(
      remove.map(deployment => async () => this.indexer.remove(deployment)),
    )

    await queue.onIdle()
  }

  async identifyExpiringAllocations(
    logger: Logger,
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
    const activeAllocations = await this.networkMonitor.allocations(
      AllocationStatus.ACTIVE,
    )

    const activeDeploymentAllocations = activeAllocations.filter(
      allocation =>
        allocation.subgraphDeployment.id.bytes32 ===
        deploymentAllocationDecision.deployment.bytes32,
    )

    switch (deploymentAllocationDecision.toAllocate) {
      case false:
        return await this.indexer.closeEligibleAllocations(
          logger,
          deploymentAllocationDecision,
          activeDeploymentAllocations,
          epoch,
        )
      case true: {
        // If no active allocations, create one
        if (activeDeploymentAllocations.length === 0) {
          return await this.indexer.createAllocation(
            logger,
            deploymentAllocationDecision,
            (
              await this.networkMonitor.closedAllocations(
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
          await this.indexer.refreshExpiredAllocations(
            logger,
            deploymentAllocationDecision,
            expiringAllocations,
          )
        }
      }
    }
  }

  async reconcileActions(
    networkDeploymentAllocationDecisions: AllocationDecision[],
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
  ): Promise<void> {
    if (
      this.indexer.allocationManagementMode == AllocationManagementMode.MANUAL
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
      !this.allocateOnNetworkSubgraph &&
      this.networkSubgraph.deployment?.id.bytes32
    ) {
      const networkSubgraphDeploymentId = this.networkSubgraph.deployment.id
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

export const startAgent = async (config: AgentConfig): Promise<Agent> => {
  const agent = new Agent(
    config.logger,
    config.metrics,
    config.indexer,
    config.network,
    config.networkMonitor,
    config.networkSubgraph,
    config.allocateOnNetworkSubgraph,
    config.registerIndexer,
    config.offchainSubgraphs,
    config.receiptCollector,
  )
  return await agent.start()
}
