import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { Eventual, Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { DocumentNode, print } from 'graphql'
import { OperationResult, CombinedError } from '@urql/core'
import { BlockPointer, IndexingError } from './types'
import { GraphNode } from './graph-node'
import { SubgraphFreshnessChecker } from './subgraphs'
import { sequentialTimerReduce } from './sequential-timer'

export interface SubgraphCreateOptions {
  logger: Logger
  name: string
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

interface SubgraphOptions {
  name: string
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

export class SubgraphClient {
  name: string
  logger: Logger
  freshnessChecker: SubgraphFreshnessChecker | undefined
  endpointClient?: AxiosInstance
  /** Endpoint URL for the Subgraph Endpoint from the config  */
  private subgraphConfigEndpoint?: string
  /** Endpoint URL for the Subgraph Endpoint from the deployment  */
  private subgraphDeploymentEndpoint?: string
  endpoint?: string

  public readonly deployment?: {
    id: SubgraphDeploymentID
    status: Eventual<DeploymentStatus>
    endpointClient: AxiosInstance
  }

  private constructor(options: SubgraphOptions) {
    this.name = options.name
    this.logger = options.logger
    this.freshnessChecker = options.subgraphFreshnessChecker
    this.subgraphConfigEndpoint = options.endpoint
    this.subgraphDeploymentEndpoint = options.deployment?.graphNode.getQueryEndpoint(
      options.deployment.id.ipfsHash,
    )

    if (options.endpoint) {
      this.endpointClient = axios.create({
        baseURL: options.endpoint,
        headers: { 'content-type': 'application/json' },

        // Don't parse responses as JSON
        responseType: 'text',

        // Don't transform responses
        transformResponse: (data) => data,
      })
      this.endpoint = this.subgraphConfigEndpoint
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
      this.endpoint = this.subgraphDeploymentEndpoint
    }
  }

  public static async create({
    logger: parentLogger,
    name,
    endpoint,
    deployment,
    subgraphFreshnessChecker,
  }: SubgraphCreateOptions): Promise<SubgraphClient> {
    // Either an endpoint or a deployment needs to be provided; the CLI
    // validation should already guarantee that but we're asserting this again
    // here, just to be on the safe side
    console.assert(endpoint || deployment)

    const logger = parentLogger.child({
      component: name,
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
        name,
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

    // Create the subgraph instance
    const subgraph = new SubgraphClient({
      name,
      logger,
      endpoint,
      deployment: deploymentInfo,
      subgraphFreshnessChecker,
    })

    // If we don't have a subgraph endpoint configured, we
    // need to wait until the deployment is synced
    if (!endpoint) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await deploymentInfo!.status.filter((status) => status.synced).value()
    }

    return subgraph
  }

  private async getClient(): Promise<AxiosInstance> {
    if (this.deployment) {
      const status = await this.deployment.status.value()
      const healthy = status.synced && status.health === 'healthy'

      if (healthy) {
        this.logger.trace(`Use own deployment for ${this.name} query`, { status })
        this.endpoint = this.subgraphDeploymentEndpoint
        return this.deployment.endpointClient
      } else if (this.endpointClient) {
        this.logger.trace(`Use provided endpoint for ${this.name} query`, { status })
        this.endpoint = this.subgraphConfigEndpoint
        return this.endpointClient
      } else {
        // We have no endpoint and our deployment is not synced or unhealthy;
        // there's no way to proceed from here, so crash
        this.logger.critical(
          `No ${this.name} deployment endpoint provided and ${this.name} deployment is unhealthy`,
        )
        process.exit(1)
      }
    } else {
      this.logger.trace(`Use provided endpoint for ${this.name} query`)
      this.endpoint = this.subgraphConfigEndpoint
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
  name,
  logger,
  graphNode,
  deployment,
}: {
  name: string
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

  return sequentialTimerReduce(
    {
      logger,
      milliseconds: 60_000,
    },
    async (lastStatus) => {
      try {
        logger.trace(`Checking the ${name} deployment status`)

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
          logger.error(`Failed to index ${name} deployment`, {
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

          logger.debug(
            `${name} is synced ${syncedPercent}% (block #${latestBlock} of #${chainHeadBlock})`,
          )
        }

        return status
      } catch (err) {
        return lastStatus
      }
    },
    initialStatus,
  )
}
