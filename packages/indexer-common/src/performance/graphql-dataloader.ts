import DataLoader from 'dataloader'
import { Logger } from '@graphprotocol/common-ts'
import gql from 'graphql-tag'
import { SubgraphClient } from '../subgraph-client'
import { Allocation } from '../allocations'
import { SubgraphDeployment } from '../types'
import {
  parseGraphQLAllocation,
  parseGraphQLSubgraphDeployment,
} from '../indexer-management/types'

export interface DataLoaderOptions {
  cache?: boolean
  maxBatchSize?: number
  batchScheduleFn?: (callback: () => void) => void
}

// Default configuration constants
const DATALOADER_DEFAULTS = {
  CACHE: true,
  MAX_BATCH_SIZE: 100,
} as const

/**
 * Custom error types for DataLoader operations
 */
export class DataLoaderError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'DataLoaderError'
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataLoaderError)
    }
  }
}

export class BatchLoadError extends DataLoaderError {
  constructor(
    operation: string,
    public readonly requestedCount: number,
    public readonly foundCount: number,
    cause?: Error,
  ) {
    super(
      `Failed to batch load ${operation}: requested ${requestedCount}, found ${foundCount}`,
      operation,
      cause,
    )
    this.name = 'BatchLoadError'
  }
}

export class QueryExecutionError extends DataLoaderError {
  constructor(
    operation: string,
    public readonly query: string,
    cause?: Error,
  ) {
    super(`Query execution failed for ${operation}`, operation, cause)
    this.name = 'QueryExecutionError'
  }
}

/**
 * GraphQL DataLoader implementation for batching and caching queries.
 * Uses the DataLoader pattern to automatically batch and cache GraphQL queries.
 *
 * Key features:
 * - Automatic request batching within a single tick
 * - Request deduplication
 * - Per-request caching
 * - Configurable batch sizes
 */
export class GraphQLDataLoader {
  private allocationLoader: DataLoader<string, Allocation | null>
  private deploymentLoader: DataLoader<string, SubgraphDeployment | null>
  private allocationsByIndexerLoader: DataLoader<string, Allocation[]>
  private logger: Logger
  private networkSubgraph: SubgraphClient
  private protocolNetwork: string
  private disposed = false

  constructor(
    logger: Logger,
    networkSubgraph: SubgraphClient,
    protocolNetwork: string,
    options: DataLoaderOptions = {},
  ) {
    this.logger = logger.child({ component: 'GraphQLDataLoader' })
    this.networkSubgraph = networkSubgraph
    this.protocolNetwork = protocolNetwork

    const defaultOptions: Required<DataLoaderOptions> = {
      cache: options.cache ?? DATALOADER_DEFAULTS.CACHE,
      maxBatchSize: options.maxBatchSize ?? DATALOADER_DEFAULTS.MAX_BATCH_SIZE,
      batchScheduleFn: options.batchScheduleFn ?? ((cb) => process.nextTick(cb)),
    }

    // Initialize allocation loader
    this.allocationLoader = new DataLoader(
      (ids: readonly string[]) => this.batchLoadAllocations(ids),
      defaultOptions,
    )

    // Initialize deployment loader
    this.deploymentLoader = new DataLoader(
      (ids: readonly string[]) => this.batchLoadDeployments(ids),
      defaultOptions,
    )

    // Initialize allocations by indexer loader
    // Key format: "indexer:status" (e.g., "0x123...abc:Active")
    this.allocationsByIndexerLoader = new DataLoader(
      (keys: readonly string[]) => this.batchLoadAllocationsByIndexer(keys),
      {
        ...defaultOptions,
        // Each key is unique per indexer+status combination
        cacheKeyFn: (key) => key,
      },
    )

    this.logger.debug('GraphQLDataLoader initialized', {
      maxBatchSize: defaultOptions.maxBatchSize,
      cacheEnabled: defaultOptions.cache,
    })
  }

  /**
   * Load a single allocation by ID
   */
  async loadAllocation(id: string): Promise<Allocation | null> {
    this.ensureNotDisposed()
    return this.allocationLoader.load(id.toLowerCase())
  }

  /**
   * Load multiple allocations by IDs
   */
  async loadAllocations(ids: string[]): Promise<(Allocation | null)[]> {
    this.ensureNotDisposed()
    const results = await this.allocationLoader.loadMany(ids.map((id) => id.toLowerCase()))
    return results.map((result) => (result instanceof Error ? null : result))
  }

  /**
   * Load allocations by indexer address and status
   */
  async loadAllocationsByIndexer(indexer: string, status: string): Promise<Allocation[]> {
    this.ensureNotDisposed()
    const key = `${indexer.toLowerCase()}:${status}`
    return this.allocationsByIndexerLoader.load(key)
  }

  /**
   * Load a single deployment by ID
   */
  async loadDeployment(id: string): Promise<SubgraphDeployment | null> {
    this.ensureNotDisposed()
    return this.deploymentLoader.load(id.toLowerCase())
  }

  /**
   * Load multiple deployments by IDs
   */
  async loadDeployments(ids: string[]): Promise<(SubgraphDeployment | null)[]> {
    this.ensureNotDisposed()
    const results = await this.deploymentLoader.loadMany(ids.map((id) => id.toLowerCase()))
    return results.map((result) => (result instanceof Error ? null : result))
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.allocationLoader.clearAll()
    this.deploymentLoader.clearAll()
    this.allocationsByIndexerLoader.clearAll()
    this.logger.debug('Cleared all DataLoader caches')
  }

  /**
   * Clear specific allocation from cache
   */
  clearAllocation(id: string): void {
    this.allocationLoader.clear(id.toLowerCase())
  }

  /**
   * Clear specific deployment from cache
   */
  clearDeployment(id: string): void {
    this.deploymentLoader.clear(id.toLowerCase())
  }

  /**
   * Clear allocations by indexer from cache
   */
  clearAllocationsByIndexer(indexer: string, status: string): void {
    const key = `${indexer.toLowerCase()}:${status}`
    this.allocationsByIndexerLoader.clear(key)
  }

  /**
   * Prime the cache with known allocation data
   */
  primeAllocation(id: string, allocation: Allocation): void {
    this.allocationLoader.prime(id.toLowerCase(), allocation)
  }

  /**
   * Prime the cache with known deployment data
   */
  primeDeployment(id: string, deployment: SubgraphDeployment): void {
    this.deploymentLoader.prime(id.toLowerCase(), deployment)
  }

  /**
   * Prime the cache with known allocations by indexer
   */
  primeAllocationsByIndexer(
    indexer: string,
    status: string,
    allocations: Allocation[],
  ): void {
    const key = `${indexer.toLowerCase()}:${status}`
    this.allocationsByIndexerLoader.prime(key, allocations)
  }

  /**
   * Batch load allocations by IDs
   */
  private async batchLoadAllocations(
    ids: readonly string[],
  ): Promise<(Allocation | null)[]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading allocations', { count: ids.length })

    try {
      // Valid GraphQL query for The Graph's network subgraph
      const query = gql`
        query batchAllocations($ids: [String!]!) {
          allocations(where: { id_in: $ids }, first: 1000) {
            id
            status
            indexer {
              id
            }
            allocatedTokens
            createdAtEpoch
            createdAtBlockHash
            closedAtEpoch
            closedAtBlockHash
            closedAtBlockNumber
            poi
            queryFeeRebates
            queryFeesCollected
            subgraphDeployment {
              id
              ipfsHash
              stakedTokens
              signalledTokens
              queryFeesAmount
              deniedAt
            }
          }
        }
      `

      const result = await this.networkSubgraph.checkedQuery(query, {
        ids: [...ids], // Convert readonly array to mutable
      })

      if (result.error) {
        throw new QueryExecutionError(
          'allocations',
          'batchAllocations',
          result.error instanceof Error ? result.error : new Error(String(result.error)),
        )
      }

      // Build a map for O(1) lookup
      const allocationsMap = new Map<string, Allocation>()
      const allocations = result.data?.allocations ?? []

      for (const allocation of allocations) {
        try {
          const parsed = parseGraphQLAllocation(allocation, this.protocolNetwork)
          allocationsMap.set(allocation.id.toLowerCase(), parsed)
        } catch (parseError) {
          this.logger.warn('Failed to parse allocation', {
            allocationId: allocation.id,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          })
        }
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded allocations', {
        requested: ids.length,
        found: allocationsMap.size,
        loadTime,
      })

      // Return in the same order as requested (DataLoader requirement)
      return ids.map((id) => allocationsMap.get(id.toLowerCase()) ?? null)
    } catch (error) {
      const wrappedError =
        error instanceof DataLoaderError
          ? error
          : new BatchLoadError(
              'allocations',
              ids.length,
              0,
              error instanceof Error ? error : new Error(String(error)),
            )

      this.logger.error('Failed to batch load allocations', {
        error: wrappedError.message,
        requestedCount: ids.length,
        operation: wrappedError.operation,
      })

      throw wrappedError
    }
  }

  /**
   * Batch load deployments by IDs
   */
  private async batchLoadDeployments(
    ids: readonly string[],
  ): Promise<(SubgraphDeployment | null)[]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading deployments', { count: ids.length })

    try {
      // Valid GraphQL query for The Graph's network subgraph
      const query = gql`
        query batchDeployments($ids: [String!]!) {
          subgraphDeployments(where: { id_in: $ids }, first: 1000) {
            id
            ipfsHash
            stakedTokens
            signalledTokens
            queryFeesAmount
            queryFeeRebates
            curatorFeeRewards
            indexingRewardAmount
            indexingIndexerRewardAmount
            indexingDelegatorRewardAmount
            deniedAt
            createdAt
          }
        }
      `

      const result = await this.networkSubgraph.checkedQuery(query, {
        ids: [...ids],
      })

      if (result.error) {
        throw new QueryExecutionError(
          'deployments',
          'batchDeployments',
          result.error instanceof Error ? result.error : new Error(String(result.error)),
        )
      }

      // Build a map for O(1) lookup
      const deploymentsMap = new Map<string, SubgraphDeployment>()
      const deployments = result.data?.subgraphDeployments ?? []

      for (const deployment of deployments) {
        try {
          const parsed = parseGraphQLSubgraphDeployment(deployment, this.protocolNetwork)
          deploymentsMap.set(deployment.id.toLowerCase(), parsed)
        } catch (parseError) {
          this.logger.warn('Failed to parse deployment', {
            deploymentId: deployment.id,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          })
        }
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded deployments', {
        requested: ids.length,
        found: deploymentsMap.size,
        loadTime,
      })

      // Return in the same order as requested
      return ids.map((id) => deploymentsMap.get(id.toLowerCase()) ?? null)
    } catch (error) {
      const wrappedError =
        error instanceof DataLoaderError
          ? error
          : new BatchLoadError(
              'deployments',
              ids.length,
              0,
              error instanceof Error ? error : new Error(String(error)),
            )

      this.logger.error('Failed to batch load deployments', {
        error: wrappedError.message,
        requestedCount: ids.length,
      })

      throw wrappedError
    }
  }

  /**
   * Batch load allocations by indexer address and status.
   * Keys are in format "indexer:status"
   */
  private async batchLoadAllocationsByIndexer(
    keys: readonly string[],
  ): Promise<Allocation[][]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading allocations by indexer', { count: keys.length })

    try {
      // Parse keys into indexer/status pairs
      const parsedKeys = keys.map((key) => {
        const [indexer, status] = key.split(':')
        return { indexer, status, key }
      })

      // Group by status for more efficient querying
      const statusGroups = new Map<string, string[]>()
      for (const { indexer, status } of parsedKeys) {
        if (!statusGroups.has(status)) {
          statusGroups.set(status, [])
        }
        statusGroups.get(status)!.push(indexer)
      }

      // Execute queries for each status group
      const allResults = new Map<string, Allocation[]>()

      for (const [status, indexers] of statusGroups) {
        // Valid GraphQL query for The Graph's network subgraph
        const query = gql`
          query allocationsByIndexer($indexers: [String!]!, $status: AllocationStatus!) {
            allocations(
              where: { indexer_in: $indexers, status: $status }
              first: 1000
              orderBy: createdAtBlockNumber
              orderDirection: desc
            ) {
              id
              status
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              createdAtBlockHash
              closedAtEpoch
              closedAtBlockHash
              closedAtBlockNumber
              poi
              queryFeeRebates
              queryFeesCollected
              subgraphDeployment {
                id
                ipfsHash
                stakedTokens
                signalledTokens
                queryFeesAmount
                deniedAt
              }
            }
          }
        `

        const result = await this.networkSubgraph.checkedQuery(query, {
          indexers: [...new Set(indexers)], // Dedupe indexers
          status,
        })

        if (result.error) {
          throw new QueryExecutionError(
            'allocationsByIndexer',
            'allocationsByIndexer',
            result.error instanceof Error ? result.error : new Error(String(result.error)),
          )
        }

        const allocations = result.data?.allocations ?? []

        // Group results by indexer
        for (const allocation of allocations) {
          try {
            const parsed = parseGraphQLAllocation(allocation, this.protocolNetwork)
            const indexerId = allocation.indexer.id.toLowerCase()
            const key = `${indexerId}:${status}`

            if (!allResults.has(key)) {
              allResults.set(key, [])
            }
            allResults.get(key)!.push(parsed)
          } catch (parseError) {
            this.logger.warn('Failed to parse allocation in batch', {
              allocationId: allocation.id,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            })
          }
        }
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded allocations by indexer', {
        requested: keys.length,
        statusGroups: statusGroups.size,
        loadTime,
      })

      // Return in the same order as requested keys
      return keys.map((key) => allResults.get(key) ?? [])
    } catch (error) {
      const wrappedError =
        error instanceof DataLoaderError
          ? error
          : new BatchLoadError(
              'allocationsByIndexer',
              keys.length,
              0,
              error instanceof Error ? error : new Error(String(error)),
            )

      this.logger.error('Failed to batch load allocations by indexer', {
        error: wrappedError.message,
        requestedCount: keys.length,
      })

      throw wrappedError
    }
  }

  /**
   * Warm up the cache with frequently accessed data
   */
  async warmup(allocationIds: string[], deploymentIds: string[]): Promise<void> {
    this.ensureNotDisposed()

    const startTime = Date.now()
    this.logger.info('Warming up DataLoader cache', {
      allocations: allocationIds.length,
      deployments: deploymentIds.length,
    })

    const results = await Promise.allSettled([
      this.loadAllocations(allocationIds),
      this.loadDeployments(deploymentIds),
    ])

    const errors = results.filter((r) => r.status === 'rejected')
    if (errors.length > 0) {
      this.logger.warn('Some warmup operations failed', {
        failedCount: errors.length,
      })
    }

    const warmupTime = Date.now() - startTime
    this.logger.info('DataLoader cache warmed up', { warmupTime })
  }

  /**
   * Ensure loader is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('GraphQLDataLoader has been disposed')
    }
  }

  /**
   * Dispose the loader and clear caches
   */
  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.clearAll()
    this.logger.debug('GraphQLDataLoader disposed')
  }

  /**
   * Support for async disposal
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose()
  }
}
