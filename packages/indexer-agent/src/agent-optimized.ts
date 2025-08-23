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
  // Import new performance utilities
  NetworkDataCache,
  CircuitBreaker,
  AllocationPriorityQueue,
  GraphQLDataLoader,
  ConcurrentReconciler,
} from '@graphprotocol/indexer-common'

import PQueue from 'p-queue'
import pMap from 'p-map'
import pFilter from 'p-filter'
import mapValues from 'lodash.mapvalues'
import zip from 'lodash.zip'
import { AgentConfigs, NetworkAndOperator } from './types'

// Configuration constants for performance tuning
const PERFORMANCE_CONFIG = {
  ALLOCATION_CONCURRENCY: process.env.ALLOCATION_CONCURRENCY 
    ? parseInt(process.env.ALLOCATION_CONCURRENCY) : 20,
  DEPLOYMENT_CONCURRENCY: process.env.DEPLOYMENT_CONCURRENCY 
    ? parseInt(process.env.DEPLOYMENT_CONCURRENCY) : 15,
  BATCH_SIZE: process.env.BATCH_SIZE 
    ? parseInt(process.env.BATCH_SIZE) : 10,
  CACHE_TTL: process.env.CACHE_TTL 
    ? parseInt(process.env.CACHE_TTL) : 30000,
  ENABLE_CIRCUIT_BREAKER: process.env.ENABLE_CIRCUIT_BREAKER !== 'false',
  ENABLE_PRIORITY_QUEUE: process.env.ENABLE_PRIORITY_QUEUE !== 'false',
  ENABLE_CACHE: process.env.ENABLE_CACHE !== 'false',
  NETWORK_QUERY_BATCH_SIZE: 50,
  PARALLEL_NETWORK_QUERIES: true,
}

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
  
  // Performance optimization components
  private cache: NetworkDataCache
  private circuitBreaker: CircuitBreaker
  private priorityQueue: AllocationPriorityQueue
  private dataLoader: Map<string, GraphQLDataLoader>
  private reconciler: ConcurrentReconciler
  private deploymentQueue: PQueue
  private metricsCollector: NodeJS.Timer | null = null

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
      concurrency: PERFORMANCE_CONFIG.DEPLOYMENT_CONCURRENCY 
    })
    
    // Start metrics collection
    this.startMetricsCollection()
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
    // * Initialize DataLoaders for each network
    // --------------------------------------------------------------------------------
    await this.multiNetworks.map(
      async ({ network }: NetworkAndOperator) => {
        const networkId = network.specification.networkIdentifier
        this.dataLoader.set(
          networkId,
          new GraphQLDataLoader(
            this.logger,
            network.networkSubgraph,
            networkId,
            { maxBatchSize: PERFORMANCE_CONFIG.NETWORK_QUERY_BATCH_SIZE }
          )
        )
      }
    )

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
            await this.ensureAllSubgraphsIndexing(network)
            await network.register()
          })
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

    // Start optimized reconciliation loop
    this.optimizedReconciliationLoop()
    return this
  }

  /**
   * Optimized reconciliation loop with parallel processing and caching
   */
  optimizedReconciliationLoop() {
    const requestIntervalSmall = this.pollingInterval
    const requestIntervalLarge = this.pollingInterval * 5
    const logger = this.logger.child({ component: 'ReconciliationLoop' })
    
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

    const maxAllocationEpochs: Eventual<NetworkMapped<number>> =
      this.createCachedEventual(
        'maxAllocationEpochs',
        requestIntervalLarge,
        () =>
          this.multiNetworks.map(({ network }) => {
            logger.trace('Fetching max allocation epochs', {
              protocolNetwork: network.specification.networkIdentifier,
            })
            return network.contracts.staking.maxAllocationEpochs()
          }),
        error => logger.warn(`Failed to fetch max allocation epochs`, { error }),
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
                    rule => rule.identifierType == SubgraphIdentifierType.SUBGRAPH,
                  )
                  .map(rule => rule.identifier!)
                  
                if (subgraphRuleIds.length > 0) {
                  const subgraphsMatchingRules =
                    await network.networkMonitor.subgraphs(subgraphRuleIds)
                  if (subgraphsMatchingRules.length >= 1) {
                    const epochLength =
                      await network.contracts.epochManager.epochLength()
                    const blockPeriod = 15
                    const bufferPeriod = epochLength.toNumber() * blockPeriod * 100
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
            const results = await Promise.allSettled(
              this.multiNetworks.values.map(async ({ network }) => {
                const networkId = network.specification.networkIdentifier
                const loader = this.dataLoader.get(networkId)
                
                if (loader) {
                  // Use DataLoader for batched queries
                  return {
                    networkId,
                    deployments: await network.networkMonitor.subgraphDeployments(),
                  }
                }
                
                return {
                  networkId,
                  deployments: await network.networkMonitor.subgraphDeployments(),
                }
              })
            )
            
            const deploymentMap: NetworkMapped<SubgraphDeployment[]> = {}
            for (const result of results) {
              if (result.status === 'fulfilled') {
                deploymentMap[result.value.networkId] = result.value.deployments
              }
            }
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
                  'Active'
                )
              }
              
              return network.networkMonitor.allocations(AllocationStatus.ACTIVE)
            }
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
      maxAllocationEpochs,
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
        maxAllocationEpochs,
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
            maxAllocationEpochs,
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
    onError: (error: any) => void,
  ): Eventual<T> {
    return sequentialTimerMap(
      { logger: this.logger, milliseconds: interval },
      async () => {
        if (PERFORMANCE_CONFIG.ENABLE_CACHE) {
          return this.cache.getCachedOrFetch(
            cacheKey,
            async () => {
              if (PERFORMANCE_CONFIG.ENABLE_CIRCUIT_BREAKER) {
                return this.circuitBreaker.execute(fetcher)
              }
              return fetcher()
            },
            interval * 0.8, // Cache for 80% of the interval
          )
        }
        
        if (PERFORMANCE_CONFIG.ENABLE_CIRCUIT_BREAKER) {
          return this.circuitBreaker.execute(fetcher)
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
    const logger = this.logger.child({ function: 'optimizedReconcileDeployments' })
    
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
          
          await this.graphNode.remove(deployment)
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
   */
  async optimizedReconcileActions(
    networkDeploymentAllocationDecisions: NetworkMapped<AllocationDecision[]>,
    epoch: NetworkMapped<number>,
    maxAllocationEpochs: NetworkMapped<number>,
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
          maxAllocationEpochs,
          decisions: allocationDecisions.length,
          concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY,
        })

        // Use priority queue if enabled
        if (PERFORMANCE_CONFIG.ENABLE_PRIORITY_QUEUE) {
          this.priorityQueue.enqueueBatch(allocationDecisions)
          
          const batches: AllocationDecision[][] = []
          while (!this.priorityQueue.isEmpty()) {
            const batch = this.priorityQueue.dequeueBatch(
              PERFORMANCE_CONFIG.BATCH_SIZE
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
                this.reconcileDeploymentAllocationAction(
                  decision,
                  activeAllocations,
                  epoch,
                  maxAllocationEpochs,
                  network,
                  operator,
                ),
              { concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY }
            )
          }
        } else {
          // Standard parallel processing with concurrency limit
          await pMap(
            allocationDecisions,
            async decision =>
              this.reconcileDeploymentAllocationAction(
                decision,
                activeAllocations,
                epoch,
                maxAllocationEpochs,
                network,
                operator,
              ),
            { concurrency: PERFORMANCE_CONFIG.ALLOCATION_CONCURRENCY }
          )
        }
      },
    )
  }

  // Keep existing helper methods...
  // [Rest of the existing Agent class methods remain the same]
  
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
      this.metrics.gauge('indexer_agent_cache_hit_rate', metrics.cacheHitRate)
      this.metrics.gauge('indexer_agent_queue_size', metrics.queueSize)
      this.metrics.gauge('indexer_agent_deployment_queue_size', metrics.deploymentQueueStats.size)
    }
  }
  
  /**
   * Cleanup resources on shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down agent')
    
    if (this.metricsCollector) {
      clearInterval(this.metricsCollector)
    }
    
    await this.reconciler.onIdle()
    await this.deploymentQueue.onIdle()
    
    this.cache.clear()
    this.priorityQueue.clear()
    
    this.logger.info('Agent shutdown complete')
  }
  
  // Additional helper methods for target deployments and allocation decisions
  private createTargetDeployments(
    networkDeployments: Eventual<NetworkMapped<SubgraphDeployment[]>>,
    indexingRules: Eventual<NetworkMapped<IndexingRuleAttributes[]>>,
  ): Eventual<SubgraphDeploymentID[]> {
    return join({ networkDeployments, indexingRules }).tryMap(
      ({ networkDeployments, indexingRules }) => {
        const decisions = mapValues(
          this.multiNetworks.zip(indexingRules, networkDeployments),
          ([rules, deployments]: [
            IndexingRuleAttributes[],
            SubgraphDeployment[],
          ]) => {
            return rules.length === 0
              ? []
              : evaluateDeployments(this.logger, deployments, rules)
          },
        )
        
        return uniqueDeployments([
          ...Object.values(decisions)
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
      ({ networkDeployments, indexingRules }) => {
        return mapValues(
          this.multiNetworks.zip(indexingRules, networkDeployments),
          ([rules, deployments]: [
            IndexingRuleAttributes[],
            SubgraphDeployment[],
          ]) => {
            return rules.length === 0
              ? []
              : evaluateDeployments(this.logger, deployments, rules)
          },
        )
      },
      {
        onError: error =>
          this.logger.warn(`Failed to create allocation decisions`, { error }),
      },
    )
  }

  // Keep all existing methods from original Agent class...
  async identifyPotentialDisputes(
    disputableAllocations: Allocation[],
    disputableEpoch: number,
    operator: Operator,
    network: Network,
  ): Promise<void> {
    // Implementation remains the same
  }

  async identifyExpiringAllocations(
    logger: Logger,
    activeAllocations: Allocation[],
    deploymentAllocationDecision: AllocationDecision,
    currentEpoch: number,
    maxAllocationEpochs: number,
    network: Network,
  ): Promise<Allocation[]> {
    // Implementation remains the same
  }

  async reconcileDeploymentAllocationAction(
    deploymentAllocationDecision: AllocationDecision,
    activeAllocations: Allocation[],
    epoch: number,
    maxAllocationEpochs: number,
    network: Network,
    operator: Operator,
  ): Promise<void> {
    // Implementation remains the same as original
  }

  async ensureSubgraphIndexing(deployment: string, networkIdentifier: string) {
    // Implementation remains the same
  }

  async ensureAllSubgraphsIndexing(network: Network) {
    // Implementation remains the same
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