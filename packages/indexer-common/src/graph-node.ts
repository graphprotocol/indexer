import gql from 'graphql-tag'
import jayson, { Client as RpcClient } from 'jayson/promise'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { Client, createClient } from '@urql/core'
import {
  INDEXER_ERROR_MESSAGES,
  IndexerError,
  indexerError,
  IndexerErrorCode,
} from './errors'
import { BlockPointer, ChainIndexingStatus, IndexingStatus } from './types'
import pRetry, { Options } from 'p-retry'
import axios, { AxiosInstance } from 'axios'
import fetch from 'isomorphic-fetch'
import yaml from 'yaml'

interface indexNode {
  id: string
  deployments: string[]
}

export interface SubgraphDeploymentAssignment {
  id: SubgraphDeploymentID
  node: string
  paused: boolean
}

export interface IndexingStatusFetcherOptions {
  logger: Logger
  statusEndpoint: string
}

export interface SubgraphFeatures {
  // `null` is only expected when Graph Node detects validation errors in the Subgraph Manifest.
  network: string | null
}

export enum SubgraphStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ALL = 'all',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLIndexingStatus = (indexingStatus: any): IndexingStatus => ({
  subgraphDeployment: new SubgraphDeploymentID(indexingStatus.subgraphDeployment),
  synced: indexingStatus.synced,
  health: indexingStatus.health,
  fatalError: indexingStatus.fatalError,
  node: indexingStatus.node,
  chains: indexingStatus.chains.map(parseGraphQLChain),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLChain = (chain: any): ChainIndexingStatus => ({
  network: chain.network,
  latestBlock: parseGraphQLBlockPointer(chain.latestBlock),
  chainHeadBlock: parseGraphQLBlockPointer(chain.chainHeadBlock),
  earliestBlock: parseGraphQLBlockPointer(chain.earliestBlock),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseGraphQLBlockPointer = (block: any): BlockPointer | null =>
  block
    ? {
        number: +block.number,
        hash: block.hash,
      }
    : null

export interface SubgraphDependencies {
  root: SubgraphDeploymentID
  dependencies: SubgraphDependency[]
}

export interface SubgraphDependency {
  base: SubgraphDeploymentID
  block: number
}

export class SubgraphManifestResolver {
  private ipfsBaseUrl: URL
  private ipfsClient: AxiosInstance
  private logger: Logger

  constructor(ipfsEndpoint: string, logger: Logger) {
    this.ipfsBaseUrl = new URL(`/api/v0/`, ipfsEndpoint)
    this.ipfsClient = axios.create({})
    this.ipfsClient.interceptors.request.use((config) => {
      logger.debug(`Subgraph Manifest IPFS request: ${config.url}`)
      return config
    })
    this.logger = logger
  }

  /**
   * Resolves a subgraph's manifest.
   *
   * @param subgraphDeploymentId
   * @returns Promise<SubgraphDependency>
   */
  public async resolve(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<SubgraphDependency> {
    const response = await this.ipfsClient.post(
      `${this.ipfsBaseUrl}cat?arg=${subgraphDeploymentId.ipfsHash}`,
    )
    return yaml.parse(response.data)
  }

  /**
   * Resolves a subgraph's manifest and its dependencies in the order that they need to be resolved.
   *
   * @param subgraphDeploymentId
   * @returns Promise<SubgraphDependencies>
   */
  public async resolveWithDependencies(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<SubgraphDependencies> {
    const deps: SubgraphDependencies = {
      root: subgraphDeploymentId,
      dependencies: [],
    }
    const root = await this.resolve(subgraphDeploymentId)
    let currentManifest = root
    let dependency = currentManifest['graft']
    while (dependency) {
      const dep = {
        block: dependency.block,
        base: new SubgraphDeploymentID(dependency.base),
      }
      // push onto the front of the list so we always have the deepest deps first
      deps.dependencies.unshift(dep)
      const nextManifest = await this.resolve(dep.base)
      currentManifest = nextManifest
      dependency = currentManifest['graft']
    }
    return deps
  }
}

export class GraphNode {
  admin: RpcClient
  private queryBaseURL: URL
  private manifestResolver: SubgraphManifestResolver | null
  private enableAutoGraft: boolean

  status: Client
  logger: Logger

  constructor(
    logger: Logger,
    adminEndpoint: string,
    queryEndpoint: string,
    statusEndpoint: string,
    ipfsEndpoint: string,
    enableAutoGraft: boolean = false,
  ) {
    this.logger = logger.child({ component: 'GraphNode' })
    this.status = createClient({
      url: statusEndpoint,
      fetch,
      requestPolicy: 'network-only',
    })

    if (adminEndpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.admin = jayson.Client.https(adminEndpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.admin = jayson.Client.http(adminEndpoint as any)
    }

    this.queryBaseURL = new URL(`/subgraphs/id/`, queryEndpoint)
    this.enableAutoGraft = enableAutoGraft

    // Only initialize manifest resolver if auto-graft is enabled
    if (enableAutoGraft && ipfsEndpoint) {
      this.manifestResolver = new SubgraphManifestResolver(
        ipfsEndpoint,
        this.logger.child({ component: 'SubgraphManifestResolver' }),
      )
      this.logger.info('Auto-graft feature enabled', { ipfsEndpoint })
    } else {
      this.manifestResolver = null
      this.logger.info('Auto-graft feature disabled')
    }
  }

  async connect(): Promise<void> {
    try {
      this.logger.info(`Check if indexing status API is available`)
      await pRetry(
        async () => {
          if (await this.statusEndpointConnected()) {
            this.logger.info(`Successfully connected to indexing status API`, {})
          } else {
            this.logger.error(`Failed to connect to indexing status API`)
            throw new Error('Indexing status API not available')
          }
        },
        {
          retries: 10,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Indexing statuses could not be queried`, {
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE024, error)
      this.logger.error(`Failed to connect to indexing status API`, {
        err,
      })
      throw err
    }
  }

  // AxiosClient factory scoped by subgraph IFPS hash
  getQueryClient(deploymentIpfsHash: string): AxiosInstance {
    return axios.create({
      baseURL: this.getQueryEndpoint(deploymentIpfsHash),
      headers: { 'content-type': 'application/json' },
      responseType: 'text', // Don't parse responses as JSON
      transformResponse: (data) => data, // Don't transform responses
    })
  }

  getQueryEndpoint(deploymentIpfsHash: string): string {
    return new URL(deploymentIpfsHash, this.queryBaseURL).toString()
  }

  // Simple query to make sure the status endpoint is connected
  public async statusEndpointConnected(): Promise<boolean> {
    try {
      const result = await this.status
        .query(
          gql`
            query {
              __typename
            }
          `,
          undefined,
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      return !!result.data
    } catch (error) {
      this.logger.error(`Failed to query status endpoint`, { error })
      return false
    }
  }

  public async subgraphDeploymentAssignmentsByDeploymentID(
    subgraphStatus: SubgraphStatus,
    deploymentIDs: string[],
  ): Promise<SubgraphDeploymentAssignment[]> {
    try {
      const nodeOnlyResult = await this.status
        .query(
          gql`
            query indexingStatuses($subgraphs: [String!]!) {
              indexingStatuses(subgraphs: $subgraphs) {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
          { subgraphs: deploymentIDs },
        )
        .toPromise()

      if (nodeOnlyResult.error) {
        throw nodeOnlyResult.error
      }

      if (
        !nodeOnlyResult.data.indexingStatuses ||
        nodeOnlyResult.data.indexingStatuses.length === 0
      ) {
        this.logger.debug(`No 'indexingStatuses' data returned from index nodes`, {
          data: nodeOnlyResult.data,
        })
        return []
      }

      const withAssignments: string[] = nodeOnlyResult.data.indexingStatuses
        .filter(
          (result: { node: string | null }) =>
            result.node !== null && result.node !== undefined,
        )
        .map((result: { subgraphDeployment: string }) => result.subgraphDeployment)

      const result = await this.status
        .query(
          gql`
            query indexingStatuses($subgraphs: [String!]!) {
              indexingStatuses(subgraphs: $subgraphs) {
                subgraphDeployment: subgraph
                node
                paused
              }
            }
          `,
          { subgraphs: withAssignments },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      if (!result.data.indexingStatuses || result.data.length === 0) {
        this.logger.warn(`No 'indexingStatuses' data returned from index nodes`, {
          data: result.data,
        })
        return []
      }

      type QueryResult = {
        subgraphDeployment: string
        node: string | undefined
        paused: boolean | undefined
      }

      const results = result.data.indexingStatuses
        .filter((status: QueryResult) => {
          if (subgraphStatus === SubgraphStatus.ACTIVE) {
            return (
              status.paused === false ||
              (status.paused === undefined && status.node !== 'removed')
            )
          } else if (subgraphStatus === SubgraphStatus.PAUSED) {
            return status.node === 'removed' || status.paused === true
          } else if (subgraphStatus === SubgraphStatus.ALL) {
            return true
          }
        })
        .map((status: QueryResult) => {
          return {
            id: new SubgraphDeploymentID(status.subgraphDeployment),
            node: status.node,
            paused: status.paused ?? status.node === 'removed',
          }
        })

      return results
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, { err })
      throw err
    }
  }

  public async subgraphDeploymentsAssignments(
    subgraphStatus: SubgraphStatus,
  ): Promise<SubgraphDeploymentAssignment[]> {
    try {
      const startTimeMs = Date.now()
      this.logger.debug('Fetch subgraph deployment assignments')

      // FIXME: remove this initial check for just node when graph-node releases
      // https://github.com/graphprotocol/graph-node/pull/5551
      const nodeOnlyResult = await this.status
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
          undefined,
        )
        .toPromise()

      const deploymentCount = nodeOnlyResult.data?.indexingStatuses?.length ?? 0
      this.logger.debug(
        `Fetch subgraph deployment assignments (1/2, node only) took ${
          Date.now() - startTimeMs
        }ms for ${deploymentCount} deployments`,
      )

      if (nodeOnlyResult.error) {
        throw nodeOnlyResult.error
      }

      const withAssignments: string[] = nodeOnlyResult.data.indexingStatuses
        .filter((result: QueryResult) => {
          return result.node !== null && result.node !== undefined
        })
        .map((result: QueryResult) => {
          return result.subgraphDeployment
        })

      const result = await this.status
        .query(
          gql`
            query indexingStatuses($subgraphs: [String!]!) {
              indexingStatuses(subgraphs: $subgraphs) {
                subgraphDeployment: subgraph
                node
                paused
              }
            }
          `,
          { subgraphs: withAssignments },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      if (!result.data.indexingStatuses || result.data.length === 0) {
        this.logger.warn(`No 'indexingStatuses' data returned from index nodes`, {
          data: result.data,
        })
        return []
      }

      type QueryResult = {
        subgraphDeployment: string
        node: string | undefined
        paused: boolean | undefined
      }

      const deploymentCount2 = result.data?.indexingStatuses?.length ?? 0
      this.logger.debug(
        `Fetch subgraph deployment assignments (2/2, with paused) took ${
          Date.now() - startTimeMs
        }ms and returned ${deploymentCount}/${deploymentCount2} deployments`,
      )
      const results = result.data.indexingStatuses
        .filter((status: QueryResult) => {
          if (subgraphStatus === SubgraphStatus.ACTIVE) {
            return (
              status.paused === false ||
              (status.paused === undefined && status.node !== 'removed')
            )
          } else if (subgraphStatus === SubgraphStatus.PAUSED) {
            return status.node === 'removed' || status.paused === true
          } else if (subgraphStatus === SubgraphStatus.ALL) {
            return true
          }
        })
        .map((status: QueryResult) => {
          return {
            id: new SubgraphDeploymentID(status.subgraphDeployment),
            node: status.node,
            paused: status.paused ?? status.node === 'removed',
          }
        })
      this.logger.debug(
        `Fetching mapped subgraph deployment ${results.length} assignments took ${
          Date.now() - startTimeMs
        }ms`,
      )
      return results
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, { err })
      throw err
    }
  }

  async indexNodes(): Promise<indexNode[]> {
    try {
      this.logger.trace(`Querying indexing statuses`)
      const result = await this.status
        .query(
          gql`
            {
              indexingStatuses {
                subgraphDeployment: subgraph
                node
              }
            }
          `,
          undefined,
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      this.logger.trace(`Queried indexing statuses`, {
        data: result.data,
      })

      if (!result.data.indexingStatuses) {
        throw new Error(
          "Received invalid results when querying indexing statuses: Response is missing a value for the 'indexingStatus' field",
        )
      }

      const indexNodes: indexNode[] = []
      result.data.indexingStatuses.map(
        (status: { subgraphDeployment: string; node: string }) => {
          const node = indexNodes.find((node) => node.id === status.node)
          node
            ? node.deployments.push(status.subgraphDeployment)
            : indexNodes.push({
                id: status.node,
                deployments: [status.subgraphDeployment],
              })
        },
      )

      this.logger.trace(`Queried index nodes`, {
        indexNodes,
      })
      return indexNodes
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query index nodes API (Should get a different IE?)`, {
        err,
      })
      throw err
    }
  }

  // --------------------------------------------------------------------------------
  // * Subgraph Management
  // --------------------------------------------------------------------------------

  async create(name: string): Promise<void> {
    try {
      this.logger.info(`Create subgraph name`, { name })
      const response = await this.admin.request('subgraph_create', { name })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully created subgraph name`, { name })
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.debug(`Subgraph name already exists, will deploy to existing name`, {
          name,
        })
        return
      }
      throw error
    }
  }

  async deploy(name: string, deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
      })

      this.logger.trace(`Response from 'subgraph_deploy' call`, {
        deployment: deployment.display,
        name,
        response,
      })

      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully deployed subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
    } catch (error) {
      // If more specific error not found use the generic 'Failed to deploy' error code
      let errorCode = IndexerErrorCode.IE026

      if (error.message && error.message.includes('network not supported')) {
        errorCode = IndexerErrorCode.IE074
      }

      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        name,
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async pause(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Pause subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_pause', {
        deployment: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully paused subgraph deployment`, {
        deployment: deployment.display,
      })
    } catch (error) {
      const errorCode = IndexerErrorCode.IE027
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        deployment: deployment.display,
        error: indexerError(errorCode, error),
      })
    }
  }

  async resume(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Resume subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.admin.request('subgraph_resume', {
        deployment: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully resumed subgraph deployment`, {
        deployment: deployment.display,
      })
    } catch (error) {
      const errorCode = IndexerErrorCode.IE076
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        deployment: deployment.display,
        error: indexerError(errorCode, error),
      })
    }
  }

  async reassign(deployment: SubgraphDeploymentID, node: string): Promise<void> {
    try {
      this.logger.info(`Reassign subgraph deployment`, {
        deployment: deployment.display,
        node,
      })
      const response = await this.admin.request('subgraph_reassign', {
        node_id: node,
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.debug(`Subgraph deployment assignment unchanged`, {
          deployment: deployment.display,
          node,
        })
        return
      }
      const errorCode = IndexerErrorCode.IE028
      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async ensure(
    name: string,
    deployment: SubgraphDeploymentID,
    currentAssignments?: SubgraphDeploymentAssignment[],
  ): Promise<void> {
    this.logger.debug('Ensure subgraph deployment is syncing', {
      name,
      deployment: deployment.ipfsHash,
    })
    try {
      const deploymentAssignments =
        currentAssignments ??
        (await this.subgraphDeploymentAssignmentsByDeploymentID(SubgraphStatus.ALL, [
          deployment.ipfsHash,
        ]))
      const matchingAssignment = deploymentAssignments.find(
        (deploymentAssignment) => deploymentAssignment.id.ipfsHash == deployment.ipfsHash,
      )

      if (matchingAssignment?.paused == false) {
        this.logger.debug('Subgraph deployment already syncing, ensure() is a no-op', {
          name,
          deployment: deployment.ipfsHash,
        })
      } else if (matchingAssignment?.paused == true) {
        this.logger.debug('Subgraph deployment paused, resuming', {
          name,
          deployment: deployment.ipfsHash,
        })
        await this.resume(deployment)
      } else {
        // Subgraph deployment not found

        // Only attempt auto-graft if enabled
        if (this.enableAutoGraft) {
          await this.autoGraftDeployDependencies(deployment, deploymentAssignments, name)
        }

        // Create and deploy the subgraph
        this.logger.debug(
          'Subgraph deployment not found, creating subgraph name and deploying...',
          {
            name,
            deployment: deployment.ipfsHash,
          },
        )
        await this.create(name)
        await this.deploy(name, deployment)
      }
    } catch (error) {
      if (!(error instanceof IndexerError)) {
        const errorCode = IndexerErrorCode.IE020
        this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], {
          name,
          deployment: deployment.display,
          error: indexerError(errorCode, error),
        })
      }
    }
  }

  /**
   * Automatically deploy any dependencies of the subgraph, returning only when they are sync'd to the specified block.
   *
   * Note: All dependencies must be present on the same network as the root deployment.
   *
   * @param deployment
   * @param deploymentAssignments
   * @param name
   * @returns
   */
  private async autoGraftDeployDependencies(
    deployment: SubgraphDeploymentID,
    deploymentAssignments: SubgraphDeploymentAssignment[],
    name: string,
  ) {
    this.logger.debug('Auto graft deploy subgraph dependencies')

    // Safety check - should not happen if called correctly from ensure()
    if (!this.manifestResolver) {
      this.logger.error('Auto-graft called but manifest resolver not initialized', {
        name,
        deployment: deployment.display,
      })
      return
    }

    const { network: subgraphChainName } = await this.subgraphFeatures(deployment)
    const dependencies = await this.manifestResolver.resolveWithDependencies(deployment)
    if (dependencies.dependencies.length == 0) {
      this.logger.debug('No subgraph dependencies found', {
        name,
        deployment: deployment.display,
      })
    } else {
      this.logger.debug('graft dependency chain found', {
        dependencies: dependencies.dependencies.map((d) => d.base.ipfsHash),
      })

      for (const dependency of dependencies.dependencies) {
        const queriedAssignments = await this.subgraphDeploymentAssignmentsByDeploymentID(
          SubgraphStatus.ACTIVE,
          [dependency.base.ipfsHash],
        )
        this.logger.debug(
          'queried graph-node for assignment',
          queriedAssignments.map((a: SubgraphDeploymentAssignment) => {
            return { ipfsHash: a.id.ipfsHash, ...a }
          }),
        )
        const dependencyAssignment = queriedAssignments.find(
          (assignment) => assignment.id.ipfsHash == dependency.base.ipfsHash,
        )

        if (dependencyAssignment) {
          this.logger.info("Dependency subgraph found, checking if it's healthy", {
            name,
            deployment: dependency.base.display,
            block_required: dependency.block,
          })

          const indexingStatus = await this.indexingStatus([dependency.base])
          const deploymentStatus = indexingStatus.find(
            (status) => status.subgraphDeployment.ipfsHash === dependency.base.ipfsHash,
          )
          if (!deploymentStatus) {
            // we found a dependency assignment, but it's not present in indexing status
            this.logger.error(`Subgraph not found in indexing status`, {
              subgraph: dependency.base.ipfsHash,
              indexingStatus,
            })
            throw new Error(`Subgraph not found in indexing status`)
          } else {
            this.logger.info(
              'Dependency subgraph found, will try to sync it to the block required',
              {
                deploymentStatus,
              },
            )
          }
        } else if (!dependencyAssignment) {
          // important:
          const idempotentName = `autograft-${dependency.base.ipfsHash.slice(0, 8)}`
          this.logger.debug('Dependency subgraph not found, creating, deploying...', {
            parentName: name,
            idempotentName,
            deployment: dependency.base.display,
            block_required: dependency.block,
          })
          // are we paused at the block we wanted?

          await this.create(idempotentName)
          await this.deploy(idempotentName, dependency.base)
        }
        await this.syncToBlock(dependency.block, dependency.base, subgraphChainName)
      }
    }
  }

  /**
   * Wait for the block to be synced, polling indexing status until it is
   * The Deployment should already be created and deployed to graph-node
   * This will resume a paused subgraph if the block height target is higher than the
   * current block height
   */
  public async syncToBlock(
    blockHeight: number,
    subgraphDeployment: SubgraphDeploymentID,
    chainName: string | null,
  ): Promise<void> {
    async function waitForMs(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    this.logger.info(`Begin syncing subgraph deployment to block`, {
      subgraph: subgraphDeployment.ipfsHash,
      blockHeight,
    })

    let lastProgressBlock = 0
    let stuckCounter = 0
    const maxStuckIterations = 20 // Increased since we're checking every 3s

    // loop-wait for the block to be synced
    for (;;) {
      // first ensure it's been deployed and is active, or already paused
      let deployed: SubgraphDeploymentAssignment[] = []
      let attempt = 0

      const maxAttempts = 5
      const waitTimeMs = 3000

      // wait and poll for the assignment to be created.
      while (attempt < maxAttempts) {
        await waitForMs(waitTimeMs)
        deployed = await this.subgraphDeploymentAssignmentsByDeploymentID(
          SubgraphStatus.ALL,
          [subgraphDeployment.ipfsHash],
        )
        if (deployed.length > 0) {
          this.logger.info(`Subgraph deployment active or already paused`, {
            subgraph: subgraphDeployment.ipfsHash,
            status: deployed,
          })
          break
        }
        this.logger.info(`Subgraph deployment not yet active, waiting...`, {
          subgraph: subgraphDeployment.ipfsHash,
          attempt,
          deployed,
        })
        attempt += 1
        if (attempt >= maxAttempts) {
          this.logger.error(`Subgraph not deployed and active`, {
            subgraph: subgraphDeployment.ipfsHash,
          })
          throw new Error(
            `Subgraph ${subgraphDeployment.ipfsHash} not deployed and active after ${maxAttempts} attempts, cannot sync to block ${blockHeight}`,
          )
        }
      }

      const indexingStatus = await this.indexingStatus([subgraphDeployment])
      const deploymentStatus = indexingStatus.find(
        (status) => status.subgraphDeployment.ipfsHash === subgraphDeployment.ipfsHash,
      )

      if (!deploymentStatus) {
        this.logger.error(`Subgraph not found in indexing status`, {
          subgraph: subgraphDeployment.ipfsHash,
          indexingStatus,
        })
        throw new Error(`Subgraph not found in indexing status`)
      }

      // Check for fatal errors - no point continuing if subgraph has failed
      if (deploymentStatus.fatalError) {
        this.logger.error(`Subgraph has fatal error, cannot sync to block`, {
          subgraph: subgraphDeployment.ipfsHash,
          targetBlock: blockHeight,
          fatalError: deploymentStatus.fatalError,
        })
        throw new Error(
          `Subgraph has fatal error: ${deploymentStatus.fatalError.message}`,
        )
      }

      // Check health status
      if (deploymentStatus.health === 'failed') {
        this.logger.error(`Subgraph is in failed state, cannot sync to block`, {
          subgraph: subgraphDeployment.ipfsHash,
          targetBlock: blockHeight,
          health: deploymentStatus.health,
        })
        throw new Error(`Subgraph is in failed state, cannot sync to target block`)
      }

      const chain = deploymentStatus.chains.find((chain) => chain.network === chainName)

      if (!chain) {
        this.logger.error(`Chain not found in indexing status for deployment`, {
          subgraph: subgraphDeployment.ipfsHash,
          chainName,
          status: deploymentStatus,
        })
        throw new Error(`Chain not found in indexing status for deployment`)
      }

      // NOTES:
      // - latestBlock is the latest block that has been indexed
      // - earliestBlock and chainHeadBlock are the earliest and latest blocks on the chain, respectively
      // if the deployment is paused and latestBlock is null or lower than we need, unpause it,
      // otherwise, if it's paused, we can't unpause it, so just wait
      if (
        deployed[0].paused &&
        (!chain.latestBlock || chain.latestBlock.number < blockHeight)
      ) {
        this.logger.debug(`Subgraph paused and not yet synced to block, resuming`, {
          subgraph: subgraphDeployment.ipfsHash,
          indexingStatus,
        })
        await this.resume(subgraphDeployment)
      }

      // Check for progress to detect stuck syncs
      const currentBlock = chain.latestBlock?.number || 0
      if (currentBlock > 0) {
        if (currentBlock === lastProgressBlock) {
          stuckCounter++
          if (stuckCounter >= maxStuckIterations) {
            this.logger.error(`Subgraph sync appears stuck at block ${currentBlock}`, {
              subgraph: subgraphDeployment.ipfsHash,
              targetBlock: blockHeight,
              stuckAtBlock: currentBlock,
              iterations: stuckCounter,
            })
            throw new Error(
              `Sync appears stuck at block ${currentBlock} after ${stuckCounter} checks`,
            )
          }
        } else {
          stuckCounter = 0
          lastProgressBlock = currentBlock
        }
      }

      // Is the graftBaseBlock within the range of the earliest and head of the chain?
      if (chain.latestBlock && chain.latestBlock.number >= blockHeight) {
        this.logger.warn(
          `Graft dependency has reached target block height. Continuing to index past graft point.`,
          {
            subgraph: subgraphDeployment.ipfsHash,
            blockHeight,
            currentBlock: chain.latestBlock.number,
          },
        )
        break
      }

      this.logger.debug(
        `Subgraph not yet synced to block ${blockHeight}, waiting for 3s`,
        {
          subgraph: subgraphDeployment.ipfsHash,
          currentBlock,
          targetBlock: blockHeight,
          progress:
            currentBlock > 0
              ? `${((currentBlock / blockHeight) * 100).toFixed(2)}%`
              : 'starting',
        },
      )
      await waitForMs(waitTimeMs)
    }

    this.logger.debug(`End syncing subgraph deployment synced to block`, {
      subgraph: subgraphDeployment.ipfsHash,
      blockHeight,
    })
  }

  // --------------------------------------------------------------------------------
  // * Indexing Status
  // --------------------------------------------------------------------------------
  public async indexingStatus(
    deployments: SubgraphDeploymentID[],
  ): Promise<IndexingStatus[]> {
    const indexingStatusesQueryBody = `
      subgraphDeployment: subgraph
      synced
      health
      fatalError {
        handler
        message
      }
      node
      chains {
        network
        ... on EthereumIndexingStatus {
          latestBlock {
            number
            hash
          }
          chainHeadBlock {
            number
            hash
          }
          earliestBlock {
            number
            hash
          }
        }
      }`
    const query =
      deployments.length > 0
        ? `query indexingStatuses($deployments: [String!]!) {
            indexingStatuses(subgraphs: $deployments) {
              ${indexingStatusesQueryBody}
            }
          }`
        : `query indexingStatuses {
            indexingStatuses {
              ${indexingStatusesQueryBody}
            }
          }`

    const queryIndexingStatuses = async () => {
      const result = await this.status
        .query(query, { deployments: deployments.map((id) => id.ipfsHash) })
        .toPromise()

      return (
        result.data.indexingStatuses
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((status: any) => ({
            ...status,
            subgraphDeployment: new SubgraphDeploymentID(status.subgraphDeployment),
          }))
      )
    }

    try {
      return await pRetry(queryIndexingStatuses, {
        retries: 5,
        maxTimeout: 10000,
        onFailedAttempt: (err) => {
          this.logger.warn(`Indexing statuses could not be queried`, {
            attempt: err.attemptNumber,
            retriesLeft: err.retriesLeft,
            deployments,
            err: err.message,
          })
        },
      } as Options)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE018, error)
      this.logger.error(`Failed to query indexing status API`, {
        deployments,
        err,
      })
      throw err
    }
  }

  public async proofOfIndexing(
    deployment: SubgraphDeploymentID,
    block: BlockPointer,
    indexerAddress: string,
  ): Promise<string | undefined> {
    try {
      return await pRetry(
        async (attempt) => {
          const result = await this.status
            .query(
              gql`
                query proofOfIndexing(
                  $subgraph: String!
                  $blockNumber: Int!
                  $blockHash: String!
                  $indexer: String!
                ) {
                  proofOfIndexing(
                    subgraph: $subgraph
                    blockNumber: $blockNumber
                    blockHash: $blockHash
                    indexer: $indexer
                  )
                }
              `,
              {
                subgraph: deployment.ipfsHash,
                blockNumber: +block.number,
                blockHash: block.hash,
                indexer: indexerAddress,
              },
            )
            .toPromise()

          if (result.error) {
            if (
              result.error.message &&
              result.error.message.includes('DeploymentNotFound')
            ) {
              return undefined
            }
            throw result.error
          }
          this.logger.trace('Reference POI generated', {
            indexer: indexerAddress,
            subgraph: deployment.ipfsHash,
            block: block,
            proof: result.data.proofOfIndexing,
            attempt,
          })

          return result.data.proofOfIndexing
        },
        {
          retries: 5,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Proof of indexing could not be queried`, {
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE019, error)
      this.logger.error(`Failed to query proof of indexing`, {
        subgraph: deployment.ipfsHash,
        blockHash: block,
        indexer: indexerAddress,
        err: err,
      })
      return undefined
    }
  }

  public async blockHashFromNumber(
    networkAlias: string,
    blockNumber: number,
  ): Promise<string> {
    this.logger.trace(`Querying blockHashFromNumber`, { networkAlias, blockNumber })
    try {
      return await pRetry(
        async (attempt) => {
          const result = await this.status
            .query(
              gql`
                query blockHashFromNumber($network: String!, $blockNumber: Int!) {
                  blockHashFromNumber(network: $network, blockNumber: $blockNumber)
                }
              `,
              {
                network: networkAlias,
                blockNumber,
              },
            )
            .toPromise()

          if (!result.data || !result.data.blockHashFromNumber || result.error) {
            throw new Error(
              `Failed to query graph node for blockHashFromNumber: ${
                result.error ?? 'no data returned'
              }`,
            )
          }

          this.logger.trace('Resolved block hash', {
            networkAlias,
            blockNumber,
            blockHash: result.data.blockHashFromNumber,
            attempt,
          })

          return `0x${result.data.blockHashFromNumber}`
        },
        {
          retries: 5,
          maxTimeout: 10000,
          onFailedAttempt: (err) => {
            this.logger.warn(`Block hash could not be queried`, {
              networkAlias,
              blockNumber,
              attempt: err.attemptNumber,
              retriesLeft: err.retriesLeft,
              err: err.message,
            })
          },
        } as Options,
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE070, error)
      this.logger.error(`Failed to query block hash`, {
        networkAlias,
        blockNumber,
        error: error.message,
      })
      throw err
    }
  }

  public async subgraphFeatures(
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<SubgraphFeatures> {
    const subgraphId = subgraphDeploymentId.ipfsHash
    try {
      const result = await this.status
        .query(
          gql`
            query subgraphFeatures($subgraphId: String!) {
              subgraphFeatures(subgraphId: $subgraphId) {
                network
              }
            }
          `,
          { subgraphId },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }
      if (!result.data) {
        throw new Error('Subgraph Deployment Not Found')
      }
      return result.data.subgraphFeatures as SubgraphFeatures
    } catch (error) {
      const errorCode = IndexerErrorCode.IE073
      const err = indexerError(errorCode, error)
      this.logger.error(INDEXER_ERROR_MESSAGES[errorCode], { err, subgraphId })
      throw err
    }
  }
}
