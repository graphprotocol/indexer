import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { Eventual, Logger, SubgraphDeploymentID, timer } from '@tokene-q/common-ts'
import { DocumentNode, print } from 'graphql'
import { OperationResult, CombinedError } from '@urql/core'
import { BlockPointer, IndexingError } from './types'
import { IndexingStatusResolver } from './indexing-status'

export interface NetworkSubgraphCreateOptions {
  logger: Logger
  endpoint?: string
  deployment?: {
    indexingStatusResolver: IndexingStatusResolver
    graphNodeQueryEndpoint: string
    deployment: SubgraphDeploymentID
  }
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
    graphNodeQueryEndpoint: string
  }
}

export type QueryResult<Data> = Pick<
  OperationResult<Data>,
  'error' | 'data' | 'extensions'
>

export class NetworkSubgraph {
  logger: Logger

  endpointClient?: AxiosInstance

  public readonly deployment?: {
    id: SubgraphDeploymentID
    client: AxiosInstance
    status: Eventual<DeploymentStatus>
  }

  private constructor(options: NetworkSubgraphOptions) {
    this.logger = options.logger

    if (options.endpoint) {
      this.endpointClient = axios.create({
        baseURL: options.endpoint,
        headers: { 'content-type': 'application/json' },

        // Don't parse responses as JSON
        responseType: 'text',

        // Don't transform responses
        transformResponse: (data) => data,
      })
    }

    if (options.deployment) {
      const client = axios.create({
        baseURL: new URL(
          `/subgraphs/id/${options.deployment.id.ipfsHash}`,
          options.deployment.graphNodeQueryEndpoint,
        ).toString(),

        headers: { 'content-type': 'application/json' },

        // Don't parse responses as JSON
        responseType: 'text',

        // Don't transform responses
        transformResponse: (data) => data,
      })
      const status = options.deployment.status

      this.deployment = {
        id: options.deployment.id,
        client,
        status,
      }
    }
  }

  public static async create({
    logger: parentLogger,
    endpoint,
    deployment,
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
          graphNodeQueryEndpoint: string
        }
      | undefined

    if (deployment) {
      const status = await monitorDeployment({
        logger,
        indexingStatusResolver: deployment.indexingStatusResolver,
        deployment: deployment.deployment,
      })

      deploymentInfo = {
        id: deployment.deployment,
        status,
        graphNodeQueryEndpoint: deployment.graphNodeQueryEndpoint,
      }
    }

    // Create the network subgraph instance
    const networkSubgraph = new NetworkSubgraph({
      logger,
      endpoint,
      deployment: deploymentInfo,
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
        return this.deployment.client
      } else if (this.endpointClient) {
        this.logger.trace('Use provided endpoint for network subgraph query')
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.endpointClient!
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
  indexingStatusResolver,
  deployment,
}: {
  logger: Logger
  indexingStatusResolver: IndexingStatusResolver
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

      const indexingStatuses = await indexingStatusResolver.indexingStatus([deployment])
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
