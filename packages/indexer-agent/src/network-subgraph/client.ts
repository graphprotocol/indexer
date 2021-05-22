import fetch from 'isomorphic-fetch'
import {
  Eventual,
  Logger,
  SubgraphDeploymentID,
  timer,
} from '@graphprotocol/common-ts'
import { DocumentNode } from 'graphql'
import { Client, OperationResult, createClient } from '@urql/core'
import { Indexer } from '../indexer'
import { IndexingError } from '../types'

export interface NetworkSubgraphCreateOptions {
  logger: Logger
  indexer: Indexer
  graphNodeQueryEndpoint: string
  endpoint?: string
  deployment?: SubgraphDeploymentID
}

interface BlockPointer {
  number: number
  hash: string
}

interface DeploymentStatus {
  health: string
  synced: boolean
  latestBlock?: BlockPointer
  chainHeadBlock?: BlockPointer
  fatalError?: IndexingError
}

interface NetworkSubgraphOptions {
  logger: Logger
  graphNodeQueryEndpoint: string
  endpoint?: string
  deployment?: {
    id: SubgraphDeploymentID
    status: Eventual<DeploymentStatus>
  }
}

export class NetworkSubgraph {
  logger: Logger

  endpointClient?: Client

  public readonly deployment?: {
    id: SubgraphDeploymentID
    client: Client
    status: Eventual<DeploymentStatus>
  }

  private constructor(options: NetworkSubgraphOptions) {
    this.logger = options.logger

    if (options.endpoint) {
      this.endpointClient = createClient({
        url: options.endpoint,
        fetch,
        requestPolicy: 'network-only',
      })
    }

    if (options.deployment) {
      const client = createClient({
        url: new URL(
          `/subgraphs/id/${options.deployment.id.ipfsHash}`,
          options.graphNodeQueryEndpoint,
        ).toString(),
        fetch,
        requestPolicy: 'network-only',
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
    indexer,
    graphNodeQueryEndpoint,
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
      deployment: deployment?.ipfsHash,
    })

    let deploymentInfo:
      | { id: SubgraphDeploymentID; status: Eventual<DeploymentStatus> }
      | undefined

    if (deployment) {
      // Make sure the network subgraph is being indexed
      await indexer.ensure(
        `${deployment.ipfsHash.slice(0, 23)}/${deployment.ipfsHash.slice(23)}`,
        deployment,
      )

      const status = await monitorDeployment({
        logger,
        indexer,
        deployment,
      })

      deploymentInfo = {
        id: deployment,
        status,
      }
    }

    // Create the network subgraph instance
    const networkSubgraph = new NetworkSubgraph({
      logger,
      graphNodeQueryEndpoint,
      endpoint,
      deployment: deploymentInfo,
    })

    // If we don't have a network subgraph endpoint configured, we
    // need to wait until the deployment is synced
    if (!endpoint) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await deploymentInfo!.status.filter(status => status.synced).value()
    }

    return networkSubgraph
  }

  private async getClient(): Promise<Client> {
    if (this.deployment) {
      const status = await this.deployment.status.value()
      const healthy = status.synced && status.health === 'healthy'

      if (healthy) {
        this.logger.debug('Use own deployment for network subgraph query')
        return this.deployment.client
      } else if (this.endpointClient) {
        this.logger.debug('Use provided endpoint for network subgraph query')
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
      this.logger.debug('Use provided endpoint for network subgraph query')
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.endpointClient!
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<Data = any>(
    query: DocumentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>,
  ): Promise<OperationResult<Data>> {
    const client = await this.getClient()
    return client.query(query, variables).toPromise()
  }
}

const monitorDeployment = async ({
  logger,
  indexer,
  deployment,
}: {
  logger: Logger
  indexer: Indexer
  deployment: SubgraphDeploymentID
}): Promise<Eventual<DeploymentStatus>> => {
  const initialStatus: DeploymentStatus = {
    health: 'healthy',
    synced: false,
    latestBlock: undefined,
    chainHeadBlock: undefined,
    fatalError: undefined,
  }

  return timer(10_000).reduce(async lastStatus => {
    try {
      logger.trace(`Checking the network subgraph deployment status`)

      const indexingStatus = await indexer.indexingStatus(deployment)

      const status = {
        health: indexingStatus.health,
        synced: indexingStatus.synced,
        latestBlock: indexingStatus.chains[0].latestBlock,
        chainHeadBlock: indexingStatus.chains[0].chainHeadBlock,
        fatalError: indexingStatus.fatalError,
      }

      // If failed for the first time, log an error
      if (!lastStatus.fatalError && status.fatalError) {
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
