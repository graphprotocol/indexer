import axios, { AxiosInstance, AxiosResponse } from 'axios'
import {
  Address,
  Eventual,
  Logger,
  SubgraphDeploymentID,
  timer,
  toAddress,
} from '@graphprotocol/common-ts'
import { DocumentNode, print } from 'graphql'
import { OperationResult, CombinedError, gql } from '@urql/core'
import { BlockPointer, IndexingError } from './types'
import { GraphNode } from './graph-node'
import { SubgraphFreshnessChecker } from './subgraphs'
import { AllocationsResponse } from './allocations/tap-collector'
import { Allocation, AllocationStatus } from './allocations/types'
import { parseGraphQLAllocation } from './indexer-management'
import { utils } from 'ethers'

export interface NetworkSubgraphCreateOptions {
  logger: Logger
  endpoint?: string
  deployment?: {
    graphNode: GraphNode
    deployment: SubgraphDeploymentID
  }
  subgraphFreshnessChecker?: SubgraphFreshnessChecker
}

interface DeploymentStatus {
  health: string
  synced: boolean
  latestBlock?: BlockPointer | null
  chainHeadBlock?: BlockPointer | null
  fatalError?: IndexingError
}

interface NetworkSubgraphOptions {
  logger: Logger
  endpoint?: string
  deployment?: {
    id: SubgraphDeploymentID
    status: Eventual<DeploymentStatus>
    graphNode: GraphNode
  }
  subgraphFreshnessChecker?: SubgraphFreshnessChecker
}

export type QueryResult<Data> = Pick<
  OperationResult<Data>,
  'error' | 'data' | 'extensions'
>

export interface AllocationQueryParams {
  indexer?: string
  lastId: string
  status?: string
  allocation?: Address
  closedAtEpochThreshold?: number
  minimumQueryFeesCollected?: string
  disputableEpoch?: number
  minimumAllocation?: number
  zeroPOI?: string
  deployments?: SubgraphDeploymentID[]
}

export interface AllocationQuery {
  params: AllocationQueryParams
  query: DocumentNode
}

export interface DefaultAllocationSelectFields {
  id: string
  subgraphDeployment: {
    id: string
    stakedTokens: string
    signalledTokens: string
  }
  indexer: {
    id: string
  }
  allocatedTokens: string
  createdAtEpoch: number
  closedAtEpoch: number
  indexingRewards: string
  queryFeesCollected: string
  status: string
}

export class AllocationQueryBuilder {
  private params: AllocationQueryParams
  constructor() {
    this.params = { lastId: '' }
  }

  setDeployments(deployments: SubgraphDeploymentID[]): AllocationQueryBuilder {
    this.params.deployments = deployments
    return this
  }

  setZeroPOI(): AllocationQueryBuilder {
    this.params.zeroPOI = utils.hexlify(Array(32).fill(0))
    return this
  }

  setMinimumAllocation(minimumAllocation: number): AllocationQueryBuilder {
    this.params.minimumAllocation = minimumAllocation
    return this
  }

  setMinimumQueryFeesCollected(
    minimumQueryFeesCollected: string,
  ): AllocationQueryBuilder {
    this.params.minimumQueryFeesCollected = minimumQueryFeesCollected
    return this
  }

  setDisputableEpoch(disputableEpoch: number): AllocationQueryBuilder {
    this.params.disputableEpoch = disputableEpoch
    return this
  }

  setClosedAtEpochThreshold(closedAtEpochThreshold: number): AllocationQueryBuilder {
    this.params.closedAtEpochThreshold = closedAtEpochThreshold
    return this
  }

  setIndexer(indexer: string): AllocationQueryBuilder {
    this.params.indexer = indexer.toLocaleLowerCase()
    return this
  }

  setStatus(status: string): AllocationQueryBuilder {
    this.params.status = status
    return this
  }

  setAllocation(allocation: string): AllocationQueryBuilder {
    this.params.allocation = toAddress(allocation.toLocaleLowerCase())
    return this
  }

  setLastId(lastId: string): AllocationQueryBuilder {
    this.params.lastId = lastId
    return this
  }

  build(): AllocationQuery {
    const query = this.generateQuery()
    return { params: this.params, query }
  }

  generateInputVariables(): string {
    const variables: string[] = []
    if (this.params.indexer) {
      variables.push('$indexer: String')
    }
    if (this.params.status) {
      variables.push('$status: String')
    }
    if (this.params.allocation) {
      variables.push('$allocation: String')
    }
    if (this.params.closedAtEpochThreshold) {
      variables.push('$closedAtEpochThreshold: Int')
    }
    if (this.params.minimumQueryFeesCollected) {
      variables.push('$minimumQueryFeesCollected: String')
    }
    if (this.params.disputableEpoch) {
      variables.push('$disputableEpoch: Int')
    }
    if (this.params.minimumAllocation) {
      variables.push('$minimumAllocation: Int')
    }
    if (this.params.deployments) {
      variables.push('$deployments: [String!]!')
    }

    return variables.join(', ')
  }

  generateWhereClause(): string {
    const clauses: string[] = []
    if (this.params.allocation) {
      clauses.push('id: $allocation')
    } else {
      clauses.push('id_gt: $lastId')
      if (this.params.indexer) {
        clauses.push('indexer: $indexer')
      }
    }
    if (this.params.status) {
      clauses.push('status: $status')
    }
    if (this.params.closedAtEpochThreshold) {
      clauses.push('closedAtEpoch_gte: $closedAtEpochThreshold')
    }
    if (this.params.minimumQueryFeesCollected) {
      clauses.push('queryFeesCollected_gte: $minimumQueryFeesCollected')
    }
    if (this.params.disputableEpoch) {
      clauses.push('closedAtEpoch_gte: $disputableEpoch')
    }
    if (this.params.minimumAllocation) {
      clauses.push('allocatedTokens_gte: $minimumAllocation')
    }
    if (this.params.deployments) {
      clauses.push('subgraphDeployment_in: $deployments')
    }

    return clauses.join(', ')
  }

  generateQuery() {
    const inputVariables = this.generateInputVariables()
    const whereClause = this.generateWhereClause()
    return gql`
      query allocations($lastId: String!, ${inputVariables}) {
        allocations(
          where: { ${whereClause} }
          orderBy: id
          orderDirection: asc
          first: 1000
        ) {
          id
          status
          subgraphDeployment {
            id
            stakedTokens
            signalledTokens
            queryFeesAmount
            deniedAt
          }
          indexer {
            id
          }
          allocatedTokens
          createdAtEpoch
          createdAtBlockHash
          closedAtEpoch
          closedAtEpoch
          closedAtBlockHash
          poi
          queryFeeRebates
          queryFeesCollected
        }
      }
    `
  }
}

export class NetworkSubgraph {
  logger: Logger
  freshnessChecker: SubgraphFreshnessChecker | undefined
  endpointClient?: AxiosInstance
  /** Endpoint URL for the Network Subgraph Endpoint from the config  */
  private networkSubgraphConfigEndpoint?: string
  /** Endpoint URL for the Network Subgraph Endpoint from the deployment  */
  private networkSubgraphDeploymentEndpoint?: string
  endpoint?: string

  public readonly deployment?: {
    id: SubgraphDeploymentID
    status: Eventual<DeploymentStatus>
    endpointClient: AxiosInstance
  }

  private constructor(options: NetworkSubgraphOptions) {
    this.logger = options.logger
    this.freshnessChecker = options.subgraphFreshnessChecker
    this.networkSubgraphConfigEndpoint = options.endpoint
    this.networkSubgraphDeploymentEndpoint =
      options.deployment?.graphNode.getQueryEndpoint(options.deployment.id.ipfsHash)

    if (options.endpoint) {
      this.endpointClient = axios.create({
        baseURL: options.endpoint,
        headers: { 'content-type': 'application/json' },

        // Don't parse responses as JSON
        responseType: 'text',

        // Don't transform responses
        transformResponse: (data) => data,
      })
      this.endpoint = this.networkSubgraphConfigEndpoint
    }

    if (options.deployment) {
      const status = options.deployment.status

      const graphNodeEndpointClient = options.deployment.graphNode.getQueryClient(
        options.deployment.id.ipfsHash,
      )

      this.deployment = {
        id: options.deployment.id,
        status,
        endpointClient: graphNodeEndpointClient,
      }
      this.endpoint = this.networkSubgraphDeploymentEndpoint
    }
  }

  public static async create({
    logger: parentLogger,
    endpoint,
    deployment,
    subgraphFreshnessChecker,
  }: NetworkSubgraphCreateOptions): Promise<NetworkSubgraph> {
    // Either an endpoint or a deployment needs to be provided; the CLI
    // validation should already guarantee that but we're asserting this again
    // here, just to be on the safe side
    console.assert(endpoint || deployment)

    const logger = parentLogger.child({
      component: 'NetworkSubgraph',
      endpoint,
      deployment: deployment?.deployment.ipfsHash,
    })

    let deploymentInfo:
      | {
          id: SubgraphDeploymentID
          status: Eventual<DeploymentStatus>
          graphNode: GraphNode
        }
      | undefined

    if (deployment) {
      const status = await monitorDeployment({
        logger,
        graphNode: deployment.graphNode,
        deployment: deployment.deployment,
      })

      deploymentInfo = {
        id: deployment.deployment,
        status,
        graphNode: deployment.graphNode,
      }
    }

    // Create the network subgraph instance
    const networkSubgraph = new NetworkSubgraph({
      logger,
      endpoint,
      deployment: deploymentInfo,
      subgraphFreshnessChecker,
    })

    // If we don't have a network subgraph endpoint configured, we
    // need to wait until the deployment is synced
    if (!endpoint) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await deploymentInfo!.status.filter((status) => status.synced).value()
    }

    return networkSubgraph
  }

  private async getClient(): Promise<AxiosInstance> {
    if (this.deployment) {
      const status = await this.deployment.status.value()
      const healthy = status.synced && status.health === 'healthy'

      if (healthy) {
        this.logger.trace('Use own deployment for network subgraph query')
        this.endpoint = this.networkSubgraphDeploymentEndpoint
        return this.deployment.endpointClient
      } else if (this.endpointClient) {
        this.logger.trace('Use provided endpoint for network subgraph query')
        this.endpoint = this.networkSubgraphConfigEndpoint
        return this.endpointClient
      } else {
        // We have no endpoint and our deployment is not synced or unhealthy;
        // there's no way to proceed from here, so crash
        this.logger.critical(
          `No network subgraph deployment endpoint provided and network subgraph deployment is unhealthy`,
        )
        process.exit(1)
      }
    } else {
      this.logger.trace('Use provided endpoint for network subgraph query')
      this.endpoint = this.networkSubgraphConfigEndpoint
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.endpointClient!
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async checkedQuery<Data = any>(
    query: DocumentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>,
  ): Promise<QueryResult<Data>> {
    if (this.freshnessChecker) {
      return this.freshnessChecker.checkedQuery(this, query, variables)
    } else {
      this.logger.warn(
        `Cannot perform 'checkedQuery' as no freshnessChecker has been configured, falling back to standard 'query'`,
      )
      return this.query(query, variables)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<Data = any>(
    query: DocumentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>,
  ): Promise<QueryResult<Data>> {
    const client = await this.getClient()
    const response = await client.post('', { query: print(query), variables })
    const data = JSON.parse(response.data)
    if (data.errors) {
      return { error: new CombinedError({ graphQLErrors: data.errors }) }
    }
    return data
  }

  async queryRaw(body: string): Promise<AxiosResponse> {
    const client = await this.getClient()
    return await client.post('', body)
  }

  public async fetchActiveAllocations(indexer: string): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(AllocationStatus.ACTIVE)
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchAllocationsByStatus(
    indexer: string,
    status: AllocationStatus,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(status)
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchRecentlyClosedAllocations(
    indexer: string,
    currentEpoch: number,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(AllocationStatus.CLOSED)
      .setClosedAtEpochThreshold(currentEpoch - 1)
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchRecentlyClosedAllocationsByRange(
    indexer: string,
    currentEpoch: number,
    range: number,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(AllocationStatus.CLOSED)
      .setClosedAtEpochThreshold(currentEpoch - range)
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchClosedAllocations(
    indexer: string,
    subgraphDeploymentId: SubgraphDeploymentID,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setAllocation(subgraphDeploymentId.toString())
      .setStatus(AllocationStatus.CLOSED)
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchClaimableAllocations(
    indexer: string,
    rebateClaimThreshold: string,
    disputableEpoch: number,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(AllocationStatus.CLOSED)
      .setDisputableEpoch(disputableEpoch)
      .setMinimumQueryFeesCollected(rebateClaimThreshold.toString())
      .build()
    return this.allocationsQuery(queryParams)
  }

  public async fetchDisputableAllocations(
    indexer: string,
    deployments: SubgraphDeploymentID[],
    disputableEpoch: number,
    minimumAllocation: number,
  ): Promise<Allocation[]> {
    const queryParams = new AllocationQueryBuilder()
      .setIndexer(indexer)
      .setStatus(AllocationStatus.CLOSED)
      .setDisputableEpoch(disputableEpoch)
      .setMinimumAllocation(minimumAllocation)
      .setDeployments(deployments)
      .setZeroPOI()
      .build()
    return this.allocationsQuery(queryParams)
  }

  /**
   *
   * @param query
   * @returns Array of allocations
   *
   * This function is used to query the network subgraph for allocations, and it handles pagination for the caller.
   */
  public async allocationsQuery(query: AllocationQuery) {
    const resultAllocations: Allocation[] = []
    for (;;) {
      const result = await this.checkedQuery(query.query, query.params)

      if (result.error) {
        this.logger.warning('Querying allocations failed', {
          error: result.error,
        })
        throw result.error
      }

      if (result.data.allocations.length == 0) {
        break
      }

      resultAllocations.push(...result.data.allocations.map(parseGraphQLAllocation))
      query.params.lastId = result.data.allocations.slice(-1)[0].id
    }
    return resultAllocations
  }

  // more of a one-off, so not using the query builder
  public async fetchTapCollectorAllocationsResponse(
    allocationIds: string[],
    pageSize: number,
  ) {
    let block: { hash: string } | undefined = undefined
    let lastId = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnedAllocations: any[] = []
    for (;;) {
      const result = await this.checkedQuery<AllocationsResponse>(
        gql`
          query allocations(
            $lastId: String!
            $pageSize: Int!
            $block: Block_height
            $allocationIds: [String!]!
          ) {
            meta: _meta(block: $block) {
              block {
                number
                hash
                timestamp
              }
            }
            allocations(
              first: $pageSize
              block: $block
              orderBy: id
              orderDirection: asc
              where: { id_gt: $lastId, id_in: $allocationIds }
            ) {
              id
              status
              subgraphDeployment {
                id
                stakedTokens
                signalledTokens
                queryFeesAmount
                deniedAt
              }
              indexer {
                id
              }
              allocatedTokens
              createdAtEpoch
              createdAtBlockHash
              closedAtEpoch
              closedAtEpoch
              closedAtBlockHash
              poi
              queryFeeRebates
              queryFeesCollected
              indexingRewards
            }
          }
        `,
        { allocationIds, lastId, pageSize: pageSize, block },
      )
      if (!result.data) {
        throw `There was an error while querying Network Subgraph.Errors: ${result.error} `
      }

      returnedAllocations.push(...result.data.allocations)
      block = { hash: result.data.meta.block.hash }
      if (result.data.allocations.length < pageSize) {
        break
      }
      lastId = result.data.allocations.slice(-1)[0].id
    }
    return returnedAllocations
  }
}

const monitorDeployment = async ({
  logger,
  graphNode,
  deployment,
}: {
  logger: Logger
  graphNode: GraphNode
  deployment: SubgraphDeploymentID
}): Promise<Eventual<DeploymentStatus>> => {
  const initialStatus: DeploymentStatus = {
    health: 'healthy',
    synced: false,
    latestBlock: undefined,
    chainHeadBlock: undefined,
    fatalError: undefined,
  }

  return timer(60_000).reduce(async (lastStatus) => {
    try {
      logger.trace(`Checking the network subgraph deployment status`)

      const indexingStatuses = await graphNode.indexingStatus([deployment])
      const indexingStatus = indexingStatuses.pop()
      if (!indexingStatus) {
        throw `No indexing status found`
      }

      const status = {
        health: indexingStatus.health,
        synced: indexingStatus.synced,
        latestBlock: indexingStatus.chains[0]?.latestBlock,
        chainHeadBlock: indexingStatus.chains[0]?.chainHeadBlock,
        fatalError: indexingStatus.fatalError,
      }

      // If failed for the first time, log an error
      if (!lastStatus || (!lastStatus.fatalError && status.fatalError)) {
        logger.error(`Failed to index network subgraph deployment`, {
          err: status.fatalError,
          latestBlock: status.latestBlock,
        })
      }

      // Don't log anything else after the subgraph has failed
      if (status.fatalError) {
        return status
      }

      // If not synced yet, log the progress so far
      if (!status.synced) {
        const latestBlock = status.latestBlock?.number || 0
        const chainHeadBlock = status.chainHeadBlock?.number || 1

        const syncedPercent = ((100 * latestBlock) / chainHeadBlock).toFixed(2)

        logger.info(
          `Network subgraph is synced ${syncedPercent}% (block #${latestBlock} of #${chainHeadBlock})`,
        )
      }

      return status
    } catch (err) {
      return lastStatus
    }
  }, initialStatus)
}
