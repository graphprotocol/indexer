/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  Eventual,
  join,
  Logger,
  Metrics,
  SubgraphDeploymentID,
  timer,
} from '@graphprotocol/common-ts'
import {
  ActivationCriteria,
  ActionStatus,
  Allocation,
  AllocationManagementMode,
  allocationRewardsPool,
  AllocationStatus,
  indexerError,
  IndexerErrorCode,
  IndexingDecisionBasis,
  IndexerManagementClient,
  IndexingRuleAttributes,
  Network,
  POIDisputeAttributes,
  RewardsPool,
  Subgraph,
  SubgraphDeployment,
  SubgraphIdentifierType,
  evaluateDeployments,
  AllocationDecision,
  GraphNode,
  Operator,
  validateProviderNetworkIdentifier,
  MultiNetworks,
  NetworkMapped,
  TransferredSubgraphDeployment,
  networkIsL2,
  networkIsL1,
  DeploymentManagementMode,
  SubgraphStatus,
  sequentialTimerMap,
} from '@graphprotocol/indexer-common'

import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'
import mapValues from 'lodash.mapvalues'
import zip from 'lodash.zip'
import { AgentConfigs, NetworkAndOperator } from './types'

type ActionReconciliationContext = [AllocationDecision[], number, number]

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

// Extracts the network identifier from a pair of matching Network and Operator objects.
function networkAndOperatorIdentity({
  network,
  operator,
}: NetworkAndOperator): string {
  const networkId = network.specification.networkIdentifier
  const operatorId = operator.specification.networkIdentifier
  if (networkId !== operatorId) {
    throw new Error(
      `Network and Operator pairs have different network identifiers: ${networkId} != ${operatorId}`,
    )
  }
  return networkId
}

// Helper function to produce a `MultiNetworks<NetworkAndOperator>` while validating its
// inputs.
function createMultiNetworks(
  networks: Network[],
  operators: Operator[],
): MultiNetworks<NetworkAndOperator> {
  // Validate that Networks and Operator arrays have even lengths and
  // contain unique, matching network identifiers.
  const visited = new Set()
  const validInputs =
    networks.length === operators.length &&
    networks.every((network, index) => {
      const sameIdentifier =
        network.specification.networkIdentifier ===
        operators[index].specification.networkIdentifier
      if (!sameIdentifier) {
        return false
      }
      if (visited.has(network.specification.networkIdentifier)) {
        return false
      }
      visited.add(network.specification.networkIdentifier)
      return true
    })

  if (!validInputs) {
    throw new Error(
      'Invalid Networks and Operator pairs used in Agent initialization',
    )
  }
  // Note on undefineds: `lodash.zip` can return `undefined` if array lengths are
  // uneven, but we have just checked that.
  const networksAndOperators = zip(networks, operators).map(pair => {
    const [network, operator] = pair
    return { network: network!, operator: operator! }
  })
  return new MultiNetworks(networksAndOperators, networkAndOperatorIdentity)
}

export class Agent {
  logger: Logger
  metrics: Metrics
  graphNode: GraphNode
  multiNetworks: MultiNetworks<NetworkAndOperator>
  indexerManagement: IndexerManagementClient
  offchainSubgraphs: SubgraphDeploymentID[]
  autoMigrationSupport: boolean
  deploymentManagement: DeploymentManagementMode
  pollingInterval: number
  indexerMinStakeThreshold: string

  constructor(configs: AgentConfigs) {
    this.logger = configs.logger.child({ component: 'Agent' })
    this.metrics = configs.metrics
    this.graphNode = configs.graphNode
    this.indexerManagement = configs.indexerManagement
    this.multiNetworks = createMultiNetworks(
      configs.networks,
      configs.operators,
    )
    this.offchainSubgraphs = configs.offchainSubgraphs
    this.autoMigrationSupport = !!configs.autoMigrationSupport
    this.deploymentManagement = configs.deploymentManagement
    this.pollingInterval = configs.pollingInterval
    this.indexerMinStakeThreshold = configs.indexerMinStakeThreshold
  }

  async start(): Promise<Agent> {
    // --------------------------------------------------------------------------------
    // * Connect to Graph Node
    // --------------------------------------------------------------------------------
    this.logger.info(`Connect to Graph node(s)`)
    try {
      await this.graphNode.connect()
    } catch {
      this.logger.critical(
        `Could not connect to Graph node(s) and query indexing statuses. Exiting. `,
      )
      process.exit(1)
    }
    this.logger.info(`Connected to Graph node(s)`)

    // --------------------------------------------------------------------------------
    // * Ensure there is a 'global' indexing rule
    // * Ensure NetworkSubgraph is indexing
    // * Register the Indexer in the Network
    // --------------------------------------------------------------------------------
    await this.multiNetworks.map(
      async ({ network, operator }: NetworkAndOperator) => {
        try {
          await operator.ensureGlobalIndexingRule()
          await this.ensureAllSubgraphsIndexing(network)
          await network.register()
        } catch (err) {
          this.logger.critical(
            `Failed to prepare indexer for ${network.specification.networkIdentifier}`,
            {
              error: err.message,
            },
          )
          process.exit(1)
        }
      },
    )

    this.reconciliationLoop()
    return this
  }

  reconciliationLoop() {
    const requestIntervalSmall = this.pollingInterval
    const requestIntervalLarge = this.pollingInterval * 5
    const logger = this.logger.child({ component: 'ReconciliationLoop' })
    const currentEpochNumber: Eventual<NetworkMapped<number>> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalLarge },
        async () =>
          await this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching current epoch number', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.networkMonitor.currentEpochNumber()
          }),
        {
          onError: error =>
            logger.warn(`Failed to fetch current epoch`, { error }),
        },
      )

    const maxAllocationEpochs: Eventual<NetworkMapped<number>> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalLarge },
        () =>
          this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching max allocation epochs', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.contracts.staking.maxAllocationEpochs()
          }),
        {
          onError: error =>
            logger.warn(`Failed to fetch max allocation epochs`, { error }),
        },
      )

    const indexingRules: Eventual<NetworkMapped<IndexingRuleAttributes[]>> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalSmall },
        async () => {
          return this.multiNetworks.map(async ({ network, operator }) => {
            logger.trace('Fetching indexing rules', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            let rules = await operator.indexingRules(true)
            const subgraphRuleIds = rules
              .filter(
                rule => rule.identifierType == SubgraphIdentifierType.SUBGRAPH,
              )
              .map(rule => rule.identifier!)
            const subgraphsMatchingRules =
              await network.networkMonitor.subgraphs(subgraphRuleIds)
            if (subgraphsMatchingRules.length >= 1) {
              const epochLength =
                await network.contracts.epochManager.epochLength()
              const blockPeriod = 15
              const bufferPeriod = epochLength.toNumber() * blockPeriod * 100 // 100 epochs
              rules = convertSubgraphBasedRulesToDeploymentBased(
                rules,
                subgraphsMatchingRules,
                bufferPeriod,
              )
            }
            return rules
          })
        },
        {
          onError: error =>
            logger.warn(`Failed to obtain indexing rules, trying again later`, {
              error,
            }),
        },
      )

    // Skip fetching active deployments if the deployment management mode is manual and POI tracking is disabled
    const activeDeployments: Eventual<SubgraphDeploymentID[]> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalLarge },
        async () => {
          if (this.deploymentManagement === DeploymentManagementMode.AUTO) {
            logger.debug('Fetching active deployments')
            const assignments =
              await this.graphNode.subgraphDeploymentsAssignments(
                SubgraphStatus.ACTIVE,
              )
            return assignments.map(assignment => assignment.id)
          } else {
            logger.info(
              "Skipping fetching active deployments fetch since DeploymentManagementMode = 'manual' and POI tracking is disabled",
            )
            return []
          }
        },
        {
          onError: error =>
            logger.warn(
              `Failed to obtain active deployments, trying again later ${error}`,
            ),
        },
      )

    const networkDeployments: Eventual<NetworkMapped<SubgraphDeployment[]>> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalSmall },
        async () =>
          await this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching network deployments', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.networkMonitor.subgraphDeployments()
          }),
        {
          onError: error =>
            logger.warn(
              `Failed to obtain network deployments, trying again later`,
              { error },
            ),
        },
      )

    const eligibleTransferDeployments: Eventual<
      NetworkMapped<TransferredSubgraphDeployment[]>
    > = sequentialTimerMap(
      { logger, milliseconds: requestIntervalLarge },
      async () => {
        // Return early if the auto migration feature is disabled.
        if (!this.autoMigrationSupport) {
          logger.trace(
            'Auto Migration feature is disabled, skipping querying transferred subgraphs',
          )
          return this.multiNetworks.map(async () => [])
        }

        const statuses = await this.graphNode.indexingStatus([])
        return this.multiNetworks.map(async ({ network }) => {
          const protocolNetwork = network.specification.networkIdentifier
          logger.trace('Fetching deployments eligible for L2 transfer', {
            protocolNetwork,
          })
          const transfers =
            await network.networkMonitor.transferredDeployments()
          logger.trace(
            `Found ${transfers.length} transferred subgraphs in the network`,
            { protocolNetwork },
          )
          return transfers
            .map(transfer => {
              const status = statuses.find(
                status =>
                  status.subgraphDeployment.ipfsHash == transfer.ipfsHash,
              )
              if (status) {
                transfer.ready = status.synced && status.health == 'healthy'
              }
              return transfer
            })
            .filter(transfer => transfer.ready == true)
        })
      },
      {
        onError: error =>
          logger.warn(
            `Failed to obtain transferred deployments, trying again later`,
            { error },
          ),
      },
    )

    // While in the L1 -> L2 transfer period this will be an intermediate value
    // with the final value including transfer considerations
    const intermediateNetworkDeploymentAllocationDecisions: Eventual<
      NetworkMapped<AllocationDecision[]>
    > = join({
      networkDeployments,
      indexingRules,
    }).tryMap(
      async ({ indexingRules, networkDeployments }) => {
        const results = await Promise.all(
          Object.entries(
            this.multiNetworks.zip(indexingRules, networkDeployments),
          ).map(
            async ([networkId, [indexingRules, networkDeployments]]: [
              string,
              [IndexingRuleAttributes[], SubgraphDeployment[]],
            ]) => {
              // Identify subgraph deployments on the network that are worth picking up;
              // these may overlap with the ones we're already indexing
              logger.trace(
                'Evaluating which deployments are worth allocating to',
                {
                  protocolNetwork: networkId,
                  deploymentCount: networkDeployments.length,
                  ruleCount: indexingRules.length,
                },
              )

              const decisions =
                indexingRules.length === 0
                  ? []
                  : await evaluateDeployments(
                      logger,
                      networkDeployments,
                      indexingRules,
                      this.indexerMinStakeThreshold,
                    )

              return [networkId, decisions] as [string, AllocationDecision[]]
            },
          ),
        )

        // Convert back to the expected object format
        return Object.fromEntries(results)
      },
      {
        onError: error =>
          logger.warn(`Failed to evaluate deployments, trying again later`, {
            error,
          }),
      },
    )

    // Update targetDeployments and networkDeplomentAllocationDecisions using transferredSubgraphDeployments data
    // This will be somewhat custom and will likely be yanked out later after the transfer stage is complete
    // Cases:
    // - L1 subgraph that had the transfer started: keep synced and allocated to for at least one week
    //   post transfer.
    // - L2 subgraph that has been transferred:
    //   - if already synced, allocate to it immediately using default allocation amount
    //   - if not synced, no changes
    const networkDeploymentAllocationDecisions: Eventual<
      NetworkMapped<AllocationDecision[]>
    > = join({
      intermediateNetworkDeploymentAllocationDecisions,
      eligibleTransferDeployments,
    }).tryMap(
      ({
        intermediateNetworkDeploymentAllocationDecisions,
        eligibleTransferDeployments,
      }) =>
        mapValues(
          this.multiNetworks.zip(
            intermediateNetworkDeploymentAllocationDecisions,
            eligibleTransferDeployments,
          ),
          ([allocationDecisions, eligibleTransferDeployments]: [
            AllocationDecision[],
            TransferredSubgraphDeployment[],
          ]) => {
            logger.debug(
              `Found ${eligibleTransferDeployments.length} deployments eligible for transfer`,
              { eligibleTransferDeployments },
            )
            const oneWeekAgo = Math.floor(Date.now() / 1_000) - 86_400 * 7
            return allocationDecisions.map(decision => {
              const matchingTransfer = eligibleTransferDeployments.find(
                deployment =>
                  deployment.ipfsHash == decision.deployment.ipfsHash &&
                  deployment.startedTransferToL2At.toNumber() > oneWeekAgo,
              )
              if (matchingTransfer) {
                logger.debug('Found a matching subgraph transfer', {
                  matchingTransfer,
                })
                // L1 deployments being transferred need to be supported for one week post transfer
                // to ensure continued support.
                if (networkIsL1(matchingTransfer.protocolNetwork)) {
                  decision.toAllocate = true
                  decision.ruleMatch.activationCriteria =
                    ActivationCriteria.L2_TRANSFER_SUPPORT
                  logger.debug(
                    `Allocating towards L1 subgraph deployment to support its transfer`,
                    {
                      subgraphDeployment: matchingTransfer,
                      allocationDecision: decision,
                    },
                  )
                }
                // L2 Deployments
                if (
                  networkIsL2(matchingTransfer.protocolNetwork) &&
                  !!matchingTransfer.transferredToL2
                ) {
                  decision.toAllocate = true
                  decision.ruleMatch.activationCriteria =
                    ActivationCriteria.L2_TRANSFER_SUPPORT
                  logger.debug(
                    `Allocating towards transferred L2 subgraph deployment`,
                    {
                      subgraphDeployment: matchingTransfer,
                      allocationDecision: decision,
                    },
                  )
                }
              }
              return decision
            })
          },
        ),
      {
        onError: error =>
          logger.warn(
            `Failed to merge L2 transfer decisions, trying again later`,
            {
              error,
            },
          ),
      },
    )

    // let targetDeployments be an union of targetAllocations
    // and offchain subgraphs.
    const targetDeployments: Eventual<SubgraphDeploymentID[]> = join({
      indexingRules,
      networkDeploymentAllocationDecisions,
    }).tryMap(
      async ({ indexingRules, networkDeploymentAllocationDecisions }) => {
        logger.trace('Resolving target deployments')
        const targetDeploymentIDs: Set<SubgraphDeploymentID> =
          consolidateAllocationDecisions(networkDeploymentAllocationDecisions)

        // Add offchain subgraphs to the deployment list from rules
        Object.values(indexingRules)
          .flat()
          .filter(
            rule => rule?.decisionBasis === IndexingDecisionBasis.OFFCHAIN,
          )
          .forEach(rule => {
            targetDeploymentIDs.add(new SubgraphDeploymentID(rule.identifier))
          })
        // From startup args
        this.offchainSubgraphs.forEach(deployment => {
          targetDeploymentIDs.add(deployment)
        })
        return [...targetDeploymentIDs]
      },
      {
        onError: error =>
          logger.warn(
            `Failed to obtain target deployments, trying again later ${error}`,
          ),
      },
    )

    const activeAllocations: Eventual<NetworkMapped<Allocation[]>> =
      sequentialTimerMap(
        { logger, milliseconds: requestIntervalSmall },
        () =>
          this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching active allocations', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.networkMonitor.allocations(AllocationStatus.ACTIVE)
          }),
        {
          onError: () =>
            logger.warn(
              `Failed to obtain active allocations, trying again later`,
            ),
        },
      )

    // `activeAllocations` is used to trigger this Eventual, but not really needed
    // inside.
    const recentlyClosedAllocations: Eventual<Allocation[]> = join({
      activeAllocations,
      currentEpochNumber,
    }).tryMap(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async ({ activeAllocations: _, currentEpochNumber }) => {
        const allocationsByNetwork = await this.multiNetworks.mapNetworkMapped(
          currentEpochNumber,
          async ({ network }, epochNumber): Promise<Allocation[]> => {
            logger.trace('Fetching recently closed allocations', {
              protocolNetwork: network.specification.networkIdentifier,
              currentEpochNumber,
            })
            return network.networkMonitor.recentlyClosedAllocations(
              epochNumber,
              1,
            )
          },
        )
        return Object.values(allocationsByNetwork).flat()
      },
      {
        onError: () =>
          logger.warn(
            `Failed to obtain active allocations, trying again later`,
          ),
      },
    )

    const disputableAllocations: Eventual<NetworkMapped<Allocation[]>> = join({
      currentEpochNumber,
      activeDeployments,
    }).tryMap(
      async ({ currentEpochNumber, activeDeployments }) =>
        this.multiNetworks.mapNetworkMapped(
          currentEpochNumber,
          ({ network }: NetworkAndOperator, currentEpochNumber: number) => {
            logger.trace('Fetching disputable allocations', {
              protocolNetwork: network.specification.networkIdentifier,
              currentEpochNumber,
            })
            return network.networkMonitor.disputableAllocations(
              currentEpochNumber,
              activeDeployments,
              0,
            )
          },
        ),

      {
        onError: () =>
          logger.warn(
            `Failed to fetch disputable allocations, trying again later`,
          ),
      },
    )

    join({
      ticker: timer(requestIntervalLarge),
      currentEpochNumber,
      maxAllocationEpochs,
      activeDeployments,
      targetDeployments,
      activeAllocations,
      networkDeploymentAllocationDecisions,
      recentlyClosedAllocations,
      disputableAllocations,
    }).pipe(
      async ({
        currentEpochNumber,
        maxAllocationEpochs,
        activeDeployments,
        targetDeployments,
        activeAllocations,
        networkDeploymentAllocationDecisions,
        recentlyClosedAllocations,
        disputableAllocations,
      }) => {
        logger.info(`Reconcile with the network`, {
          currentEpochNumber,
        })

        try {
          const disputableEpochs = await this.multiNetworks.mapNetworkMapped(
            currentEpochNumber,
            async (
              { network }: NetworkAndOperator,
              currentEpochNumber: number,
            ) =>
              currentEpochNumber -
              network.specification.indexerOptions.poiDisputableEpochs,
          )

          // Find disputable allocations
          await this.multiNetworks.mapNetworkMapped(
            this.multiNetworks.zip(disputableEpochs, disputableAllocations),
            async (
              { network, operator }: NetworkAndOperator,
              [disputableEpoch, disputableAllocations]: [number, Allocation[]],
            ): Promise<void> => {
              await this.identifyPotentialDisputes(
                disputableAllocations,
                disputableEpoch,
                operator,
                network,
              )
            },
          )
        } catch (err) {
          logger.warn(`Failed POI dispute monitoring`, { err })
        }

        const eligibleAllocations: Allocation[] = [
          ...recentlyClosedAllocations,
          ...Object.values(activeAllocations).flat(),
        ]

        // Reconcile deployments
        switch (this.deploymentManagement) {
          case DeploymentManagementMode.AUTO:
            try {
              await this.reconcileDeployments(
                activeDeployments,
                targetDeployments,
                eligibleAllocations,
              )
            } catch (err) {
              logger.warn(
                `Exited early while reconciling deployments. Skipped reconciling actions.`,
                {
                  err: indexerError(IndexerErrorCode.IE005, err),
                },
              )
              return
            }
            break
          case DeploymentManagementMode.MANUAL:
            this.logger.debug(
              `Skipping subgraph deployment reconciliation since DeploymentManagementMode = 'manual'`,
            )
            break
          default:
            throw new Error(
              `Unexpected parameter for DeploymentManagementMode: ${this.deploymentManagement}`,
            )
        }

        try {
          // Reconcile allocation actions
          await this.reconcileActions(
            networkDeploymentAllocationDecisions,
            currentEpochNumber,
            maxAllocationEpochs,
          )
        } catch (err) {
          logger.warn(`Exited early while reconciling actions`, {
            err: indexerError(IndexerErrorCode.IE005, err),
          })
          return
        }
      },
    )
  }

  async identifyPotentialDisputes(
    disputableAllocations: Allocation[],
    disputableEpoch: number,
    operator: Operator,
    network: Network,
  ): Promise<void> {
    // TODO: Support supplying status = 'any' to fetchPOIDisputes() to fetch all previously processed allocations in a single query

    this.logger.trace(`Identifying potential disputes`, {
      protocolNetwork: network.specification.networkIdentifier,
    })

    const alreadyProcessed = (
      await operator.fetchPOIDisputes(
        'potential',
        disputableEpoch,
        operator.specification.networkIdentifier,
      )
    ).concat(
      await operator.fetchPOIDisputes(
        'valid',
        disputableEpoch,
        operator.specification.networkIdentifier,
      ),
    )

    const newDisputableAllocations = disputableAllocations.filter(
      allocation =>
        !alreadyProcessed.find(
          dispute => dispute.allocationID == allocation.id,
        ),
    )
    if (newDisputableAllocations.length === 0) {
      this.logger.trace(
        'No new disputable allocations to process for potential disputes',
        { protocolNetwork: network.specification.networkIdentifier },
      )
      return
    }

    this.logger.debug(
      `Found new allocations onchain for subgraphs we have indexed. Let's compare POIs to identify any potential indexing disputes`,
      { protocolNetwork: network.specification.networkIdentifier },
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
            await network.networkProvider.getBlock(
              pool.closedAtEpochStartBlockHash!,
            )

          // Todo: Lazily fetch this, only if the first reference POI doesn't match
          const previousEpochStartBlock =
            await network.networkProvider.getBlock(
              pool.previousEpochStartBlockHash!,
            )
          pool.closedAtEpochStartBlockNumber = closedAtEpochStartBlock.number
          pool.referencePOI = await this.graphNode.proofOfIndexing(
            pool.subgraphDeployment,
            {
              number: closedAtEpochStartBlock.number,
              hash: closedAtEpochStartBlock.hash,
            },
            pool.allocationIndexer,
          )
          pool.previousEpochStartBlockHash = previousEpochStartBlock.hash
          pool.previousEpochStartBlockNumber = previousEpochStartBlock.number
          pool.referencePreviousPOI = await this.graphNode.proofOfIndexing(
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
          protocolNetwork: network.specification.networkIdentifier,
        } as POIDisputeAttributes
      },
    )

    const potentialDisputes = disputes.filter(
      dispute => dispute.status == 'potential',
    ).length
    const stored = await operator.storePoiDisputes(disputes)

    this.logger.info(`Disputable allocations' POIs validated`, {
      potentialDisputes: potentialDisputes,
      validAllocations: stored.length - potentialDisputes,
    })
  }

  // This function assumes that allocations and deployments passed to it have already
  // been retrieved from multiple networks.
  async reconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
    eligibleAllocations: Allocation[],
  ): Promise<void> {
    const logger = this.logger.child({ function: 'reconcileDeployments' })
    logger.debug('Reconcile deployments')
    // ----------------------------------------------------------------------------------------
    // Ensure the network subgraph deployment is _always_ indexed
    // ----------------------------------------------------------------------------------------
    let indexingNetworkSubgraph = false
    await this.multiNetworks.map(async ({ network }) => {
      if (network.networkSubgraph.deployment) {
        const networkDeploymentID = network.networkSubgraph.deployment.id
        if (!deploymentInList(targetDeployments, networkDeploymentID)) {
          targetDeployments.push(networkDeploymentID)
          indexingNetworkSubgraph = true
        }
      }
    })

    // ----------------------------------------------------------------------------------------
    // Inspect Deployments and Networks
    // ----------------------------------------------------------------------------------------
    // Ensure all subgraphs in offchain subgraphs list are _always_ indexed
    for (const offchainSubgraph of this.offchainSubgraphs) {
      if (!deploymentInList(targetDeployments, offchainSubgraph)) {
        targetDeployments.push(offchainSubgraph)
      }
    }
    activeDeployments = uniqueDeployments(activeDeployments)
    targetDeployments = uniqueDeployments(targetDeployments)

    // Note eligibleAllocations are active or recently closed allocations still eligible
    // for queries from the gateway
    const eligibleAllocationDeployments = uniqueDeployments(
      eligibleAllocations.map(allocation => allocation.subgraphDeployment.id),
    )

    // Identify which subgraphs to deploy and which to pause
    const deploy = targetDeployments.filter(
      deployment => !deploymentInList(activeDeployments, deployment),
    )
    const pause = activeDeployments.filter(
      deployment =>
        !deploymentInList(targetDeployments, deployment) &&
        !deploymentInList(eligibleAllocationDeployments, deployment),
    )

    if (deploy.length + pause.length !== 0) {
      logger.info('Deployment changes', {
        indexingNetworkSubgraph,
        syncing: activeDeployments.map(id => id.display),
        target: targetDeployments.map(id => id.display),
        withActiveOrRecentlyClosedAllocation: eligibleAllocationDeployments.map(
          id => id.display,
        ),
        deploy: deploy.map(id => id.display),
        pause: pause.map(id => id.display),
      })
    } else {
      logger.debug('No deployment changes are necessary')
    }
    // ----------------------------------------------------------------------------------------
    // Execute Deployments (Add, Pause)
    // ----------------------------------------------------------------------------------------

    // Deploy/remove up to 10 subgraphs in parallel
    const queue = new PQueue({ concurrency: 10 })

    const currentAssignments =
      await this.graphNode.subgraphDeploymentsAssignments(SubgraphStatus.ALL)
    // Index all new deployments worth indexing
    await queue.addAll(
      deploy.map(deployment => async () => {
        const name = `indexer-agent/${deployment.ipfsHash.slice(-10)}`

        logger.info(`Index subgraph deployment`, {
          name,
          deployment: deployment.display,
        })

        // Ensure the deployment is deployed to the indexer
        await this.graphNode.ensure(name, deployment, currentAssignments)
      }),
    )

    // Stop indexing deployments that are no longer worth indexing
    await queue.addAll(
      pause.map(deployment => async () => this.graphNode.pause(deployment)),
    )

    await queue.onIdle()
    logger.debug('Finished reconciling deployments')
  }

  async identifyExpiringAllocations(
    _logger: Logger,
    activeAllocations: Allocation[],
    deploymentAllocationDecision: AllocationDecision,
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
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
            await network.contracts.staking.getAllocation(allocation.id)
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
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<void> {
    const logger = this.logger.child({
      deployment: deploymentAllocationDecision.deployment.ipfsHash,
      protocolNetwork: network.specification.networkIdentifier,
      epoch,
    })

    // TODO: Can we replace `filter` for `find` here? Is there such a case when we
    // would have multiple allocations for the same subgraph?
    const activeDeploymentAllocations = activeAllocations.filter(
      allocation =>
        allocation.subgraphDeployment.id.bytes32 ===
        deploymentAllocationDecision.deployment.bytes32,
    )

    switch (deploymentAllocationDecision.toAllocate) {
      case false:
        return await operator.closeEligibleAllocations(
          logger,
          deploymentAllocationDecision,
          activeDeploymentAllocations,
        )
      case true: {
        // If no active allocations and subgraph health passes safety check, create one
        const indexingStatuses = await this.graphNode.indexingStatus([
          deploymentAllocationDecision.deployment,
        ])
        const indexingStatus = indexingStatuses.find(
          status =>
            status.subgraphDeployment.ipfsHash ==
            deploymentAllocationDecision.deployment.ipfsHash,
        )
        const failsHealthCheck =
          (indexingStatus &&
            indexingStatus.health == 'failed' &&
            deploymentAllocationDecision.ruleMatch.rule?.safety) ||
          !indexingStatus
        if (activeDeploymentAllocations.length === 0) {
          if (failsHealthCheck) {
            logger.warn(
              'Subgraph deployment has failed health check, skipping allocate',
              {
                indexingStatus,
                safety: deploymentAllocationDecision.ruleMatch.rule?.safety,
              },
            )
          } else {
            // Fetch the latest closed allocation, if any
            const mostRecentlyClosedAllocation = (
              await network.networkMonitor.closedAllocations(
                deploymentAllocationDecision.deployment,
              )
            )[0]
            return await operator.createAllocation(
              logger,
              deploymentAllocationDecision,
              mostRecentlyClosedAllocation,
            )
          }
        } else if (activeDeploymentAllocations.length > 0) {
          if (failsHealthCheck) {
            return await operator.closeEligibleAllocations(
              logger,
              deploymentAllocationDecision,
              activeDeploymentAllocations,
            )
          } else {
            // Refresh any expiring allocations
            const expiringAllocations = await this.identifyExpiringAllocations(
              logger,
              activeDeploymentAllocations,
              deploymentAllocationDecision,
              epoch,
              maxAllocationEpochs,
              network,
            )
            if (expiringAllocations.length > 0) {
              await operator.refreshExpiredAllocations(
                logger,
                deploymentAllocationDecision,
                expiringAllocations,
              )
            }
          }
        }
      }
    }
  }

  async reconcileActions(
    networkDeploymentAllocationDecisions: NetworkMapped<AllocationDecision[]>,
    epoch: NetworkMapped<number>,
    maxAllocationEpochs: NetworkMapped<number>,
  ): Promise<void> {
    // --------------------------------------------------------------------------------
    // Filter out networks set to `manual` allocation management mode, and ensure the
    // Network Subgraph is NEVER allocated towards
    // --------------------------------------------------------------------------------
    const validatedAllocationDecisions =
      await this.multiNetworks.mapNetworkMapped(
        networkDeploymentAllocationDecisions,
        async (
          { network }: NetworkAndOperator,
          allocationDecisions: AllocationDecision[],
        ) => {
          if (
            network.specification.indexerOptions.allocationManagementMode ===
            AllocationManagementMode.MANUAL
          ) {
            this.logger.trace(
              `Skipping allocation reconciliation since AllocationManagementMode = 'manual'`,
              {
                protocolNetwork: network.specification.networkIdentifier,
                targetDeployments: allocationDecisions
                  .filter(decision => decision.toAllocate)
                  .map(decision => decision.deployment.ipfsHash),
              },
            )
            return [] as AllocationDecision[]
          }
          const networkSubgraphDeployment = network.networkSubgraph.deployment
          if (
            networkSubgraphDeployment &&
            !network.specification.indexerOptions.allocateOnNetworkSubgraph
          ) {
            const networkSubgraphIndex = allocationDecisions.findIndex(
              decision =>
                decision.deployment.bytes32 ==
                networkSubgraphDeployment.id.bytes32,
            )
            if (networkSubgraphIndex >= 0) {
              allocationDecisions[networkSubgraphIndex].toAllocate = false
            }
          }
          return allocationDecisions
        },
      )

    //----------------------------------------------------------------------------------------
    // For every network, loop through all deployments and queue allocation actions if needed
    //----------------------------------------------------------------------------------------
    await this.multiNetworks.mapNetworkMapped(
      this.multiNetworks.zip3(
        validatedAllocationDecisions,
        epoch,
        maxAllocationEpochs,
      ),
      async (
        { network, operator }: NetworkAndOperator,
        [
          allocationDecisions,
          epoch,
          maxAllocationEpochs,
        ]: ActionReconciliationContext,
      ) => {
        // Do nothing if there are already approved actions in the queue awaiting execution
        const approvedActions = await operator.fetchActions({
          status: ActionStatus.APPROVED,
          protocolNetwork: network.specification.networkIdentifier,
        })
        if (approvedActions.length > 0) {
          this.logger.info(
            `There are ${approvedActions.length} approved actions awaiting execution, will reconcile with the network once they are executed`,
            { protocolNetwork: network.specification.networkIdentifier },
          )
          return
        }

        // Accuracy check: re-fetch allocations to ensure that we have a fresh state since the
        // start of the reconciliation loop. This means we don't use the allocations coming from
        // the Eventual input.
        const activeAllocations: Allocation[] =
          await network.networkMonitor.allocations(AllocationStatus.ACTIVE)

        this.logger.trace(`Reconcile allocation actions`, {
          protocolNetwork: network.specification.networkIdentifier,
          epoch,
          maxAllocationEpochs,
          targetDeployments: allocationDecisions
            .filter(decision => decision.toAllocate)
            .map(decision => decision.deployment.ipfsHash),
          activeAllocations: activeAllocations.map(allocation => ({
            id: allocation.id,
            deployment: allocation.subgraphDeployment.id.ipfsHash,
            createdAtEpoch: allocation.createdAtEpoch,
          })),
        })

        return pMap(allocationDecisions, async decision =>
          this.reconcileDeploymentAllocationAction(
            decision,
            activeAllocations,
            epoch,
            maxAllocationEpochs,
            network,
            operator,
          ),
        )
      },
    )
  }

  // TODO: After indexer-service deprecation: Move to be an initialization check inside Network.create()
  async ensureSubgraphIndexing(deployment: string, networkIdentifier: string) {
    try {
      // TODO: Check both the local deployment and the external subgraph endpoint
      // Make sure the subgraph is being indexed
      await this.graphNode.ensure(
        `indexer-agent/${deployment.slice(-10)}`,
        new SubgraphDeploymentID(deployment),
      )

      // Validate if the Network Subgraph belongs to the current provider's network.
      // This check must be performed after we ensure the Network Subgraph is being indexed.
      await validateProviderNetworkIdentifier(
        networkIdentifier,
        deployment,
        this.graphNode,
        this.logger,
      )
    } catch (e) {
      this.logger.warn(
        'Failed to deploy and validate Network Subgraph on index-nodes. Will use external subgraph endpoint instead',
        e,
      )
    }
  }
  async ensureAllSubgraphsIndexing(network: Network) {
    // Network subgraph
    if (
      network.specification.subgraphs.networkSubgraph.deployment !== undefined
    ) {
      await this.ensureSubgraphIndexing(
        network.specification.subgraphs.networkSubgraph.deployment,
        network.specification.networkIdentifier,
      )
    }
    // Epoch subgraph
    if (
      network.specification.subgraphs.epochSubgraph.deployment !== undefined
    ) {
      await this.ensureSubgraphIndexing(
        network.specification.subgraphs.epochSubgraph.deployment,
        network.specification.networkIdentifier,
      )
    }
    // TAP subgraph
    if (network.specification.subgraphs.tapSubgraph?.deployment !== undefined) {
      await this.ensureSubgraphIndexing(
        network.specification.subgraphs.tapSubgraph.deployment,
        network.specification.networkIdentifier,
      )
    }
  }
}

export interface AllocationDecisionInterface {
  toAllocate: boolean
  deployment: SubgraphDeploymentID
}
export function consolidateAllocationDecisions(
  allocationDecisions: Record<string, AllocationDecisionInterface[]>,
): Set<SubgraphDeploymentID> {
  return new Set(
    Object.values(allocationDecisions)
      .flat()
      .filter(decision => decision.toAllocate === true)
      .map(decision => decision.deployment),
  )
}
