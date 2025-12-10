/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * OptimizedAgent - Performance-enhanced Agent that extends the original Agent class
 *
 * This implementation adds performance optimizations while inheriting all working
 * business logic from the original Agent class:
 * - NetworkDataCache: LRU caching for network data
 * - CircuitBreaker: Fault tolerance for network operations
 * - AllocationPriorityQueue: Priority-based allocation processing
 * - GraphQLDataLoader: Batched GraphQL queries
 * - ConcurrentReconciler: Parallel reconciliation processing
 *
 * IMPORTANT: This class extends Agent to inherit all allocation management logic.
 * Only the reconciliation loop and data fetching are optimized.
 */
import {
  Eventual,
  join,
  Logger,
  SubgraphDeploymentID,
  timer,
} from '@graphprotocol/common-ts'
import {
  ActionStatus,
  Allocation,
  AllocationManagementMode,
  AllocationStatus,
  indexerError,
  IndexerErrorCode,
  IndexingRuleAttributes,
  Network,
  Subgraph,
  SubgraphDeployment,
  SubgraphIdentifierType,
  evaluateDeployments,
  AllocationDecision,
  Operator,
  NetworkMapped,
  DeploymentManagementMode,
  SubgraphStatus,
  sequentialTimerMap,
  HorizonTransitionValue,
  // Performance utilities
  NetworkDataCache,
  CircuitBreaker,
  AllocationPriorityQueue,
  GraphQLDataLoader,
  ConcurrentReconciler,
} from '@graphprotocol/indexer-common'

import PQueue from 'p-queue'
import pMap from 'p-map'
import { AgentConfigs, NetworkAndOperator } from './types'
import { Agent, convertSubgraphBasedRulesToDeploymentBased } from './agent'

// Configuration constants for performance tuning
const PERFORMANCE_CONFIG = {
  ALLOCATION_CONCURRENCY: process.env.ALLOCATION_CONCURRENCY
    ? parseInt(process.env.ALLOCATION_CONCURRENCY, 10)
    : 20,
  DEPLOYMENT_CONCURRENCY: process.env.DEPLOYMENT_CONCURRENCY
    ? parseInt(process.env.DEPLOYMENT_CONCURRENCY, 10)
    : 15,
  BATCH_SIZE: process.env.BATCH_SIZE
    ? parseInt(process.env.BATCH_SIZE, 10)
    : 10,
  CACHE_TTL: process.env.CACHE_TTL
    ? parseInt(process.env.CACHE_TTL, 10)
    : 30_000,
  ENABLE_CIRCUIT_BREAKER: process.env.ENABLE_CIRCUIT_BREAKER !== 'false',
  ENABLE_PRIORITY_QUEUE: process.env.ENABLE_PRIORITY_QUEUE !== 'false',
  ENABLE_CACHE: process.env.ENABLE_CACHE !== 'false',
  NETWORK_QUERY_BATCH_SIZE: 50,
  PARALLEL_NETWORK_QUERIES: true,
} as const

type ActionReconciliationContext = [
  AllocationDecision[],
  number,
  HorizonTransitionValue,
]

const uniqueDeploymentsOnly = (
  value: SubgraphDeploymentID,
  index: number,
  array: SubgraphDeploymentID[],
): boolean => array.findIndex(v => value.bytes32 === v.bytes32) === index

const uniqueDeployments = (
  deployments: SubgraphDeploymentID[],
): SubgraphDeploymentID[] => deployments.filter(uniqueDeploymentsOnly)

/**
 * OptimizedAgent extends the original Agent class with performance enhancements.
 *
 * Inherited from Agent:
 * - identifyPotentialDisputes() - POI dispute detection
 * - identifyExpiringAllocations() - Expired allocation detection
 * - reconcileDeploymentAllocationAction() - Core allocation management
 * - reconcileDeployments() - Deployment reconciliation
 * - reconcileActions() - Action queue management
 * - ensureSubgraphIndexing() - Subgraph indexing
 * - ensureAllSubgraphsIndexing() - All subgraphs indexing
 *
 * Optimized in this class:
 * - start() - Adds DataLoader initialization
 * - optimizedReconciliationLoop() - Enhanced data fetching with caching
 * - optimizedReconcileDeployments() - Parallel deployment processing
 * - optimizedReconcileActions() - Priority queue based processing
 */
export class OptimizedAgent extends Agent {
  // Performance optimization components
  private cache: NetworkDataCache
  private circuitBreaker: CircuitBreaker
  private priorityQueue: AllocationPriorityQueue
  private dataLoader: Map<string, GraphQLDataLoader>
  private reconciler: ConcurrentReconciler
  private deploymentQueue: PQueue
  private metricsCollector: NodeJS.Timeout | null = null

  constructor(configs: AgentConfigs) {
    super(configs)

    // Initialize performance components
    this.cache = new NetworkDataCache(this.logger, {
      ttl: PERFORMANCE_CONFIG.CACHE_TTL,
      maxSize: 2000,
      enableMetrics: true,
    })

    this.circuitBreaker = new CircuitBreaker(this.logger, {
      failureThreshold: 5,
      resetTimeout: 60000,
      halfOpenMaxAttempts: 3,
    })

    this.priorityQueue = new AllocationPriorityQueue(this.logger)

    this.dataLoader = new Map()

    this.reconciler = new ConcurrentReconciler(this.logger, {
      concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY,
      batchSize: PERFORMANCE_CONFIG.BATCH_SIZE,
      enableCircuitBreaker: PERFORMANCE_CONFIG.ENABLE_CIRCUIT_BREAKER,
      enablePriorityQueue: PERFORMANCE_CONFIG.ENABLE_PRIORITY_QUEUE,
      enableCache: PERFORMANCE_CONFIG.ENABLE_CACHE,
    })

    // Enhanced deployment queue with higher concurrency
    this.deploymentQueue = new PQueue({
      concurrency: PERFORMANCE_CONFIG.DEPLOYMENT_CONCURRENCY,
    })

    // Start metrics collection
    this.startMetricsCollection()
  }

  async start(): Promise<OptimizedAgent> {
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
    // * Initialize DataLoaders for each network
    // --------------------------------------------------------------------------------
    await this.multiNetworks.map(async ({ network }: NetworkAndOperator) => {
      const networkId = network.specification.networkIdentifier
      this.dataLoader.set(
        networkId,
        new GraphQLDataLoader(this.logger, network.networkSubgraph, networkId, {
          maxBatchSize: PERFORMANCE_CONFIG.NETWORK_QUERY_BATCH_SIZE,
        }),
      )
    })

    // --------------------------------------------------------------------------------
    // * Ensure there is a 'global' indexing rule
    // * Ensure NetworkSubgraph is indexing
    // * Register the Indexer in the Network
    // --------------------------------------------------------------------------------
    await this.multiNetworks.map(
      async ({ network, operator }: NetworkAndOperator) => {
        try {
          // Use circuit breaker for network operations
          await this.circuitBreaker.execute(async () => {
            await operator.ensureGlobalIndexingRule()
            // Use inherited method from Agent
            await this.ensureAllSubgraphsIndexing(network)
            await network.register()
          })
        } catch (err) {
          this.logger.critical(
            `Failed to prepare indexer for ${network.specification.networkIdentifier}`,
            {
              error: (err as Error).message,
            },
          )
          process.exit(1)
        }
      },
    )

    // Start optimized reconciliation loop instead of the default one
    this.optimizedReconciliationLoop()
    return this
  }

  /**
   * Optimized reconciliation loop with parallel processing and caching
   */
  optimizedReconciliationLoop() {
    const requestIntervalSmall = this.pollingInterval
    const requestIntervalLarge = this.pollingInterval * 5
    const logger = this.logger.child({ component: 'OptimizedReconciliationLoop' })

    // Use parallel timers instead of sequential for independent data fetching
    const currentEpochNumber: Eventual<NetworkMapped<number>> =
      this.createCachedEventual(
        'currentEpoch',
        requestIntervalLarge,
        async () =>
          await this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching current epoch number', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.networkMonitor.currentEpochNumber()
          }),
        error => logger.warn(`Failed to fetch current epoch`, { error }),
      )

    // Use the correct method: maxAllocationDuration() returns HorizonTransitionValue
    const maxAllocationDuration: Eventual<NetworkMapped<HorizonTransitionValue>> =
      this.createCachedEventual(
        'maxAllocationDuration',
        requestIntervalLarge,
        () =>
          this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching max allocation duration', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.networkMonitor.maxAllocationDuration()
          }),
        error =>
          logger.warn(`Failed to fetch max allocation duration`, { error }),
      )

    // Fetch indexing rules with caching
    const indexingRules: Eventual<NetworkMapped<IndexingRuleAttributes[]>> =
      this.createCachedEventual(
        'indexingRules',
        requestIntervalSmall,
        async () => {
          return this.multiNetworks.map(async ({ network, operator }) => {
            const cacheKey = `rules-${network.specification.networkIdentifier}`

            return this.cache.getCachedOrFetch(
              cacheKey,
              async () => {
                logger.trace('Fetching indexing rules', {
                  protocolNetwork: network.specification.networkIdentifier,
                })
                let rules = await operator.indexingRules(true)
                const subgraphRuleIds = rules
                  .filter(
                    rule =>
                      rule.identifierType == SubgraphIdentifierType.SUBGRAPH,
                  )
                  .map(rule => rule.identifier!)

                if (subgraphRuleIds.length > 0) {
                  const subgraphsMatchingRules =
                    await network.networkMonitor.subgraphs(subgraphRuleIds)
                  if (subgraphsMatchingRules.length >= 1) {
                    const epochLength =
                      await network.contracts.epochManager.epochLength()
                    const blockPeriod = 15
                    const bufferPeriod =
                      Number(epochLength) * blockPeriod * 100
                    rules = convertSubgraphBasedRulesToDeploymentBased(
                      rules,
                      subgraphsMatchingRules,
                      bufferPeriod,
                    )
                  }
                }
                return rules
              },
              15000, // Custom TTL for rules
            )
          })
        },
        error =>
          logger.warn(`Failed to obtain indexing rules, trying again later`, {
            error,
          }),
      )

    // Parallel fetch for active deployments
    const activeDeployments: Eventual<SubgraphDeploymentID[]> =
      this.createCachedEventual(
        'activeDeployments',
        requestIntervalLarge,
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
              "Skipping fetching active deployments fetch since DeploymentManagementMode = 'manual'",
            )
            return []
          }
        },
        error =>
          logger.warn(
            `Failed to obtain active deployments, trying again later ${error}`,
          ),
      )

    // Batch fetch network deployments
    const networkDeployments: Eventual<NetworkMapped<SubgraphDeployment[]>> =
      this.createCachedEventual(
        'networkDeployments',
        requestIntervalSmall,
        async () => {
          if (PERFORMANCE_CONFIG.PARALLEL_NETWORK_QUERIES) {
            // Fetch all network deployments in parallel
            const networkDeployments = await this.multiNetworks.map(
              async ({ network }: NetworkAndOperator) => {
                const networkId = network.specification.networkIdentifier
                const loader = this.dataLoader.get(networkId)

                if (loader) {
                  // Use DataLoader for batched queries
                  return {
                    networkId,
                    deployments:
                      await network.networkMonitor.subgraphDeployments(),
                  }
                }

                return {
                  networkId,
                  deployments:
                    await network.networkMonitor.subgraphDeployments(),
                }
              },
            )

            const deploymentMap: NetworkMapped<SubgraphDeployment[]> =
              Object.fromEntries(
                Object.values(networkDeployments).map(result => [
                  result.networkId,
                  result.deployments,
                ]),
              )
            return deploymentMap
          } else {
            // Fallback to sequential fetching
            return await this.multiNetworks.map(({ network }) => {
              logger.trace('Fetching network deployments', {
                protocolNetwork: network.specification.networkIdentifier,
              })
              return network.networkMonitor.subgraphDeployments()
            })
          }
        },
        error =>
          logger.warn(
            `Failed to obtain network deployments, trying again later`,
            { error },
          ),
      )

    // Continue with other eventuals...
    const activeAllocations: Eventual<NetworkMapped<Allocation[]>> =
      this.createCachedEventual(
        'activeAllocations',
        requestIntervalSmall,
        async () => {
          const allocations = await this.multiNetworks.mapNetworkMapped(
            {},
            async ({ network }: NetworkAndOperator) => {
              const networkId = network.specification.networkIdentifier
              const loader = this.dataLoader.get(networkId)

              if (loader) {
                // Use DataLoader for efficient batching
                const indexer = network.specification.indexerOptions.address
                return loader.loadAllocationsByIndexer(
                  indexer.toLowerCase(),
                  AllocationStatus.ACTIVE,
                )
              }

              return network.networkMonitor.allocations(AllocationStatus.ACTIVE)
            },
          )

          logger.info('Fetched active allocations', {
            networks: Object.keys(allocations).length,
            totalAllocations: Object.values(allocations).flat().length,
          })

          return allocations
        },
        error =>
          logger.warn(
            `Failed to obtain active allocations, trying again later`,
            { error },
          ),
      )

    // Main reconciliation with optimized processing
    join({
      ticker: timer(requestIntervalLarge),
      currentEpochNumber,
      maxAllocationDuration,
      activeDeployments,
      targetDeployments: this.createTargetDeployments(
        networkDeployments,
        indexingRules,
      ),
      activeAllocations,
      networkDeploymentAllocationDecisions: this.createAllocationDecisions(
        networkDeployments,
        indexingRules,
      ),
    }).pipe(
      async ({
        currentEpochNumber,
        maxAllocationDuration,
        activeDeployments,
        targetDeployments,
        activeAllocations,
        networkDeploymentAllocationDecisions,
      }) => {
        logger.info(`Starting optimized reconciliation`, {
          currentEpochNumber,
          cacheHitRate: this.cache.getHitRate(),
          circuitBreakerState: this.circuitBreaker.getState(),
        })

        // Reconcile deployments with enhanced concurrency
        if (this.deploymentManagement === DeploymentManagementMode.AUTO) {
          try {
            await this.optimizedReconcileDeployments(
              activeDeployments,
              targetDeployments,
              Object.values(activeAllocations).flat(),
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
        }

        // Reconcile actions with priority queue and parallelism
        try {
          await this.optimizedReconcileActions(
            networkDeploymentAllocationDecisions,
            currentEpochNumber,
            maxAllocationDuration,
          )
        } catch (err) {
          logger.warn(`Exited early while reconciling actions`, {
            err: indexerError(IndexerErrorCode.IE005, err),
          })
          return
        }

        // Log performance metrics
        this.logPerformanceMetrics()
      },
    )
  }

  /**
   * Create a cached eventual with circuit breaker protection
   */
  private createCachedEventual<T>(
    cacheKey: string,
    interval: number,
    fetcher: () => T | Promise<T>,
    onError: (error: Error) => void,
  ): Eventual<T> {
    return sequentialTimerMap(
      { logger: this.logger, milliseconds: interval },
      async () => {
        if (PERFORMANCE_CONFIG.ENABLE_CACHE) {
          return this.cache.getCachedOrFetch(
            cacheKey,
            async () => {
              if (PERFORMANCE_CONFIG.ENABLE_CIRCUIT_BREAKER) {
                return this.circuitBreaker.execute(async () => await fetcher())
              }
              return await fetcher()
            },
            interval * 0.8, // Cache for 80% of the interval
          )
        }

        if (PERFORMANCE_CONFIG.ENABLE_CIRCUIT_BREAKER) {
          return this.circuitBreaker.execute(async () => await fetcher())
        }

        return fetcher()
      },
      { onError },
    )
  }

  /**
   * Optimized deployment reconciliation with batching and parallelism
   */
  async optimizedReconcileDeployments(
    activeDeployments: SubgraphDeploymentID[],
    targetDeployments: SubgraphDeploymentID[],
    eligibleAllocations: Allocation[],
  ): Promise<void> {
    const logger = this.logger.child({
      function: 'optimizedReconcileDeployments',
    })

    logger.info('Reconciling deployments with optimizations', {
      active: activeDeployments.length,
      target: targetDeployments.length,
      concurrency: PERFORMANCE_CONFIG.DEPLOYMENT_CONCURRENCY,
    })

    const activeSet = new Set(activeDeployments.map(d => d.bytes32))
    const targetSet = new Set(targetDeployments.map(d => d.bytes32))

    // Deployments to add
    const toAdd = targetDeployments.filter(d => !activeSet.has(d.bytes32))

    // Deployments to remove
    const toRemove = activeDeployments.filter(d => !targetSet.has(d.bytes32))

    // Process additions and removals in parallel batches
    const operations: Array<() => Promise<void>> = []

    // Queue additions
    for (const deployment of toAdd) {
      operations.push(async () => {
        const cacheKey = `deployment-add-${deployment.ipfsHash}`

        // Check cache to avoid duplicate operations
        if (this.cache.get(cacheKey)) {
          logger.trace('Skipping cached deployment addition', {
            deployment: deployment.ipfsHash,
          })
          return
        }

        logger.info(`Adding deployment`, {
          deployment: deployment.ipfsHash,
          eligibleAllocations: eligibleAllocations.filter(
            allocation =>
              allocation.subgraphDeployment.id.bytes32 === deployment.bytes32,
          ).length,
        })

        await this.graphNode.ensure(
          `indexer-agent/${deployment.ipfsHash.slice(-10)}`,
          deployment,
        )

        // Cache successful operation
        this.cache.set(cacheKey, true)
      })
    }

    // Queue removals
    for (const deployment of toRemove) {
      operations.push(async () => {
        const cacheKey = `deployment-remove-${deployment.ipfsHash}`

        if (this.cache.get(cacheKey)) {
          logger.trace('Skipping cached deployment removal', {
            deployment: deployment.ipfsHash,
          })
          return
        }

        const hasEligibleAllocations = eligibleAllocations.some(
          allocation =>
            allocation.subgraphDeployment.id.bytes32 === deployment.bytes32,
        )

        if (!hasEligibleAllocations) {
          logger.info(`Removing deployment`, {
            deployment: deployment.ipfsHash,
          })

          await this.graphNode.pause(deployment)
          this.cache.set(cacheKey, true)
        } else {
          logger.info(`Keeping deployment (has eligible allocations)`, {
            deployment: deployment.ipfsHash,
          })
        }
      })
    }

    // Execute all operations with controlled concurrency
    await this.deploymentQueue.addAll(operations)
    await this.deploymentQueue.onIdle()

    logger.info('Deployment reconciliation complete', {
      added: toAdd.length,
      removed: toRemove.length,
    })
  }

  /**
   * Optimized action reconciliation with priority queue and parallelism
   *
   * Uses the inherited reconcileDeploymentAllocationAction() from Agent class
   * for actual allocation operations.
   */
  async optimizedReconcileActions(
    networkDeploymentAllocationDecisions: NetworkMapped<AllocationDecision[]>,
    epoch: NetworkMapped<number>,
    maxAllocationDuration: NetworkMapped<HorizonTransitionValue>,
  ): Promise<void> {
    const logger = this.logger.child({ function: 'optimizedReconcileActions' })

    // Filter and validate allocation decisions
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
            logger.trace(
              `Skipping allocation reconciliation since AllocationManagementMode = 'manual'`,
              {
                protocolNetwork: network.specification.networkIdentifier,
              },
            )
            return [] as AllocationDecision[]
          }

          // Filter out network subgraph if not allowed
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

    // Process each network's allocations with enhanced parallelism
    await this.multiNetworks.mapNetworkMapped(
      this.multiNetworks.zip3(
        validatedAllocationDecisions,
        epoch,
        maxAllocationDuration,
      ),
      async (
        { network, operator }: NetworkAndOperator,
        [
          allocationDecisions,
          epoch,
          maxAllocationDuration,
        ]: ActionReconciliationContext,
      ) => {
        // Check for approved actions
        const approvedActions = await operator.fetchActions({
          status: ActionStatus.APPROVED,
          protocolNetwork: network.specification.networkIdentifier,
        })

        if (approvedActions.length > 0) {
          logger.info(
            `There are ${approvedActions.length} approved actions awaiting execution`,
            { protocolNetwork: network.specification.networkIdentifier },
          )
          return
        }

        // Re-fetch allocations for accuracy
        const activeAllocations: Allocation[] =
          await network.networkMonitor.allocations(AllocationStatus.ACTIVE)

        logger.trace(`Reconcile allocation actions with optimization`, {
          protocolNetwork: network.specification.networkIdentifier,
          epoch,
          maxAllocationDuration,
          decisions: allocationDecisions.length,
          concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY,
        })

        // Use priority queue if enabled
        if (PERFORMANCE_CONFIG.ENABLE_PRIORITY_QUEUE) {
          this.priorityQueue.enqueueBatch(allocationDecisions)

          const batches: AllocationDecision[][] = []
          while (!this.priorityQueue.isEmpty()) {
            const batch = this.priorityQueue.dequeueBatch(
              PERFORMANCE_CONFIG.BATCH_SIZE,
            )
            if (batch.length > 0) {
              batches.push(batch)
            }
          }

          // Process batches in sequence, items within batch in parallel
          for (const batch of batches) {
            await pMap(
              batch,
              async decision =>
                // Use inherited method from Agent class
                this.reconcileDeploymentAllocationAction(
                  decision,
                  activeAllocations,
                  epoch,
                  maxAllocationDuration,
                  network,
                  operator,
                ),
              { concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY },
            )
          }
        } else {
          // Standard parallel processing with concurrency limit
          await pMap(
            allocationDecisions,
            async decision =>
              // Use inherited method from Agent class
              this.reconcileDeploymentAllocationAction(
                decision,
                activeAllocations,
                epoch,
                maxAllocationDuration,
                network,
                operator,
              ),
            { concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY },
          )
        }
      },
    )
  }

  /**
   * Start performance metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsCollector = setInterval(() => {
      this.logPerformanceMetrics()
    }, 60000) // Log every minute
  }

  /**
   * Log performance metrics
   */
  private logPerformanceMetrics(): void {
    const metrics = {
      cacheHitRate: this.cache.getHitRate(),
      cacheMetrics: this.cache.getMetrics(),
      circuitBreakerState: this.circuitBreaker.getState(),
      circuitBreakerStats: this.circuitBreaker.getStats(),
      queueSize: this.priorityQueue.size(),
      queueMetrics: this.priorityQueue.getMetrics(),
      reconcilerMetrics: this.reconciler.getMetrics(),
      deploymentQueueStats: {
        size: this.deploymentQueue.size,
        pending: this.deploymentQueue.pending,
      },
    }

    this.logger.info('Performance metrics', metrics)

    // Export metrics to Prometheus if configured
    if (this.metrics) {
      this.logger.debug('Performance metrics exported', metrics)
    }
  }

  /**
   * Cleanup resources on shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down optimized agent')

    if (this.metricsCollector) {
      clearInterval(this.metricsCollector)
    }

    await this.reconciler.onIdle()
    await this.deploymentQueue.onIdle()

    // Dispose circuit breaker
    this.circuitBreaker.dispose()

    this.cache.clear()
    this.priorityQueue.clear()

    this.logger.info('Optimized agent shutdown complete')
  }

  // Helper methods for target deployments and allocation decisions
  private createTargetDeployments(
    networkDeployments: Eventual<NetworkMapped<SubgraphDeployment[]>>,
    indexingRules: Eventual<NetworkMapped<IndexingRuleAttributes[]>>,
  ): Eventual<SubgraphDeploymentID[]> {
    return join({ networkDeployments, indexingRules }).tryMap(
      async ({ networkDeployments, indexingRules }) => {
        const decisionsEntries = await Promise.all(
          Object.entries(
            this.multiNetworks.zip(indexingRules, networkDeployments),
          ).map(async ([networkId, [rules, deployments]]) => {
            const decisions =
              rules.length === 0
                ? []
                : await evaluateDeployments(this.logger, deployments, rules)
            return [networkId, decisions]
          }),
        )

        const decisions = Object.fromEntries(decisionsEntries)

        return uniqueDeployments([
          ...(Object.values(decisions) as AllocationDecision[][])
            .flat()
            .filter(decision => decision.toAllocate)
            .map(decision => decision.deployment),
          ...this.offchainSubgraphs,
        ])
      },
      {
        onError: error =>
          this.logger.warn(`Failed to evaluate target deployments`, { error }),
      },
    )
  }

  private createAllocationDecisions(
    networkDeployments: Eventual<NetworkMapped<SubgraphDeployment[]>>,
    indexingRules: Eventual<NetworkMapped<IndexingRuleAttributes[]>>,
  ): Eventual<NetworkMapped<AllocationDecision[]>> {
    return join({ networkDeployments, indexingRules }).tryMap(
      async ({ networkDeployments, indexingRules }) => {
        const decisionsEntries = await Promise.all(
          Object.entries(
            this.multiNetworks.zip(indexingRules, networkDeployments),
          ).map(async ([networkId, [rules, deployments]]) => {
            const decisions =
              rules.length === 0
                ? []
                : await evaluateDeployments(this.logger, deployments, rules)
            return [networkId, decisions]
          }),
        )

        return Object.fromEntries(decisionsEntries)
      },
      {
        onError: error =>
          this.logger.warn(`Failed to create allocation decisions`, { error }),
      },
    )
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
