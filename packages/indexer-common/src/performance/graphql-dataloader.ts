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

/**
 * Specific error types for DataLoader operations
 */
export class DataLoaderError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'DataLoaderError'
  }
}

export class BatchLoadError extends DataLoaderError {
  constructor(
    operation: string,
    public readonly requestedCount: number,
    cause?: Error,
  ) {
    super(
      `Failed to batch load ${operation} (requested: ${requestedCount})`,
      operation,
      cause,
    )
  }
}

/**
 * GraphQL DataLoader implementation for batching and caching queries
 */
export class GraphQLDataLoader {
  private allocationLoader: DataLoader<string, Allocation | null>
  private deploymentLoader: DataLoader<string, SubgraphDeployment | null>
  private multiAllocationLoader: DataLoader<
    { indexer: string; status: string },
    Allocation[]
  >
  private logger: Logger
  private networkSubgraph: SubgraphClient
  private protocolNetwork: string

  constructor(
    logger: Logger,
    networkSubgraph: SubgraphClient,
    protocolNetwork: string,
    options: DataLoaderOptions = {},
  ) {
    this.logger = logger.child({ component: 'GraphQLDataLoader' })
    this.networkSubgraph = networkSubgraph
    this.protocolNetwork = protocolNetwork

    const defaultOptions: DataLoaderOptions = {
      cache: true,
      maxBatchSize: 100,
      batchScheduleFn: (callback) => process.nextTick(callback),
      ...options,
    }

    // Initialize allocation loader
    this.allocationLoader = new DataLoader(
      async (ids: readonly string[]) => this.batchLoadAllocations(ids),
      defaultOptions,
    )

    // Initialize deployment loader
    this.deploymentLoader = new DataLoader(
      async (ids: readonly string[]) => this.batchLoadDeployments(ids),
      defaultOptions,
    )

    // Initialize multi-allocation loader for complex queries
    this.multiAllocationLoader = new DataLoader(
      async (keys: readonly { indexer: string; status: string }[]) =>
        this.batchLoadMultiAllocations(keys),
      {
        ...defaultOptions,
        cacheKeyFn: (key) => `${key.indexer}-${key.status}`,
      },
    )
  }

  /**
   * Load a single allocation
   */
  async loadAllocation(id: string): Promise<Allocation | null> {
    return this.allocationLoader.load(id)
  }

  /**
   * Load multiple allocations
   */
  async loadAllocations(ids: string[]): Promise<(Allocation | null)[]> {
    const results = await this.allocationLoader.loadMany(ids)
    return results.map((result) => (result instanceof Error ? null : result))
  }

  /**
   * Load allocations by indexer and status
   */
  async loadAllocationsByIndexer(indexer: string, status: string): Promise<Allocation[]> {
    return this.multiAllocationLoader.load({ indexer, status })
  }

  /**
   * Load a single deployment
   */
  async loadDeployment(id: string): Promise<SubgraphDeployment | null> {
    return this.deploymentLoader.load(id)
  }

  /**
   * Load multiple deployments
   */
  async loadDeployments(ids: string[]): Promise<(SubgraphDeployment | null)[]> {
    const results = await this.deploymentLoader.loadMany(ids)
    return results.map((result) => (result instanceof Error ? null : result))
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.allocationLoader.clearAll()
    this.deploymentLoader.clearAll()
    this.multiAllocationLoader.clearAll()
    this.logger.debug('Cleared all DataLoader caches')
  }

  /**
   * Clear specific allocation from cache
   */
  clearAllocation(id: string): void {
    this.allocationLoader.clear(id)
  }

  /**
   * Clear specific deployment from cache
   */
  clearDeployment(id: string): void {
    this.deploymentLoader.clear(id)
  }

  /**
   * Prime the cache with known data
   */
  primeAllocation(id: string, allocation: Allocation): void {
    this.allocationLoader.prime(id, allocation)
  }

  /**
   * Prime the cache with known deployment data
   */
  primeDeployment(id: string, deployment: SubgraphDeployment): void {
    this.deploymentLoader.prime(id, deployment)
  }

  /**
   * Batch load allocations
   */
  private async batchLoadAllocations(
    ids: readonly string[],
  ): Promise<(Allocation | null)[]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading allocations', { count: ids.length })

    try {
      const query = gql`
        query batchAllocations($ids: [String!]!) {
          allocations(where: { id_in: $ids }) {
            id
            status
            indexer {
              id
            }
            allocatedTokens
            createdAtEpoch
            createdAtBlockHash
            closedAtEpoch
            subgraphDeployment {
              id
              ipfsHash
              stakedTokens
              signalledTokens
              queryFeesAmount
            }
          }
        }
      `

      const result = await this.networkSubgraph.checkedQuery(query, {
        ids: ids.map((id) => id.toLowerCase()),
      })

      if (result.error) {
        throw new BatchLoadError('allocations', ids.length, result.error)
      }

      const allocationsMap = new Map<string, Allocation>()
      for (const allocation of result.data.allocations || []) {
        allocationsMap.set(
          allocation.id.toLowerCase(),
          parseGraphQLAllocation(allocation, this.protocolNetwork),
        )
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded allocations', {
        requested: ids.length,
        found: allocationsMap.size,
        loadTime,
      })

      // Return in the same order as requested
      return ids.map((id) => allocationsMap.get(id.toLowerCase()) || null)
    } catch (error) {
      const batchError = error instanceof BatchLoadError ? error : 
        new BatchLoadError('allocations', ids.length, error instanceof Error ? error : undefined)
      this.logger.error('Failed to batch load allocations', { 
        error: batchError.message,
        requestedCount: ids.length,
        operation: batchError.operation 
      })
      throw batchError
    }
  }

  /**
   * Batch load deployments
   */
  private async batchLoadDeployments(
    ids: readonly string[],
  ): Promise<(SubgraphDeployment | null)[]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading deployments', { count: ids.length })

    try {
      const query = gql`
        query batchDeployments($ids: [String!]!) {
          subgraphDeployments(where: { id_in: $ids }) {
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
        ids: ids.map((id) => id.toLowerCase()),
      })

      if (result.error) {
        throw new BatchLoadError('deployments', ids.length, result.error)
      }

      const deploymentsMap = new Map<string, SubgraphDeployment>()
      for (const deployment of result.data.subgraphDeployments || []) {
        deploymentsMap.set(
          deployment.id.toLowerCase(),
          parseGraphQLSubgraphDeployment(deployment, this.protocolNetwork),
        )
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded deployments', {
        requested: ids.length,
        found: deploymentsMap.size,
        loadTime,
      })

      // Return in the same order as requested
      return ids.map((id) => deploymentsMap.get(id.toLowerCase()) || null)
    } catch (error) {
      this.logger.error('Failed to batch load deployments', { error })
      throw error
    }
  }

  /**
   * Batch load allocations by indexer and status
   */
  private async batchLoadMultiAllocations(
    keys: readonly { indexer: string; status: string }[],
  ): Promise<Allocation[][]> {
    const startTime = Date.now()
    this.logger.trace('Batch loading multi-allocations', { count: keys.length })

    try {
      // Group by unique indexers to minimize queries
      const indexerGroups = new Map<string, Set<string>>()
      for (const key of keys) {
        if (!indexerGroups.has(key.indexer)) {
          indexerGroups.set(key.indexer, new Set())
        }
        indexerGroups.get(key.indexer)!.add(key.status)
      }

      // Build optimized query for all unique combinations
      const query = gql`
        query batchMultiAllocations($queries: [AllocationQuery!]!) {
          batchAllocations: allocations(where: { OR: $queries }, first: 1000) {
            id
            status
            indexer {
              id
            }
            allocatedTokens
            createdAtEpoch
            createdAtBlockHash
            closedAtEpoch
            subgraphDeployment {
              id
              ipfsHash
              stakedTokens
              signalledTokens
              queryFeesAmount
            }
          }
        }
      `

      const queries = Array.from(indexerGroups.entries()).flatMap(([indexer, statuses]) =>
        Array.from(statuses).map((status) => ({
          indexer: indexer.toLowerCase(),
          status,
        })),
      )

      const result = await this.networkSubgraph.checkedQuery(query, { queries })

      if (result.error) {
        throw new BatchLoadError('multi-allocations', keys.length, result.error)
      }

      // Group allocations by indexer and status
      const allocationsMap = new Map<string, Allocation[]>()
      for (const allocation of result.data.batchAllocations || []) {
        const key = `${allocation.indexer.id}-${allocation.status}`
        if (!allocationsMap.has(key)) {
          allocationsMap.set(key, [])
        }
        allocationsMap
          .get(key)!
          .push(parseGraphQLAllocation(allocation, this.protocolNetwork))
      }

      const loadTime = Date.now() - startTime
      this.logger.debug('Batch loaded multi-allocations', {
        requested: keys.length,
        loadTime,
      })

      // Return in the same order as requested
      return keys.map((key) => {
        const mapKey = `${key.indexer.toLowerCase()}-${key.status}`
        return allocationsMap.get(mapKey) || []
      })
    } catch (error) {
      this.logger.error('Failed to batch load multi-allocations', { error })
      throw error
    }
  }

  /**
   * Warm up the cache with frequently accessed data
   */
  async warmup(allocationIds: string[], deploymentIds: string[]): Promise<void> {
    const startTime = Date.now()
    this.logger.info('Warming up DataLoader cache', {
      allocations: allocationIds.length,
      deployments: deploymentIds.length,
    })

    await Promise.all([
      this.loadAllocations(allocationIds),
      this.loadDeployments(deploymentIds),
    ])

    const warmupTime = Date.now() - startTime
    this.logger.info('DataLoader cache warmed up', { warmupTime })
  }
}
