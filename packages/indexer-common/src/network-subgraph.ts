import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { Eventual, Logger, SubgraphDeploymentID, timer } from '@graphprotocol/common-ts'
import { DocumentNode, print } from 'graphql'
import { OperationResult, CombinedError } from '@urql/core'
import { BlockPointer, IndexingError } from './types'
import { GraphNode } from './graph-node'
import { SubgraphFreshnessChecker } from './subgraphs'

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
