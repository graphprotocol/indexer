import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import jayson, { Client } from 'jayson/promise'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import fetch from 'node-fetch'

export class Indexer {
  statuses: ApolloClient<NormalizedCacheObject>
  rpc: Client
  logger: Logger

  constructor(adminEndpoint: string, statusEndpoint: string, logger: Logger) {
    this.statuses = new ApolloClient({
      link: new HttpLink({
        uri: statusEndpoint,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetch: fetch as any,
      }),
      cache: new InMemoryCache(),
    })
    this.logger = logger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.rpc = jayson.Client.http(adminEndpoint as any)
  }

  async connect(): Promise<void> {
    try {
      this.logger.info(`Check if indexing status API is available`)
      const currentDeployments = await this.subgraphDeployments()
      this.logger.info(`Successfully connected to indexing status API`, {
        currentDeployments: currentDeployments.map(
          deployment => deployment.display,
        ),
      })
    } catch (e) {
      this.logger.error(`Failed to connect to indexing status API`)
      throw e
    }
  }

  async subgraphDeployments(): Promise<SubgraphDeploymentID[]> {
    try {
      const result = await this.statuses.query({
        query: gql`
          query {
            indexingStatuses {
              subgraphDeployment: subgraph
              node
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return result.data.indexingStatuses
        .filter((status: { subgraphDeployment: string; node: string }) => {
          return status.node !== 'removed'
        })
        .map((status: { subgraphDeployment: string; node: string }) => {
          return new SubgraphDeploymentID(status.subgraphDeployment)
        })
    } catch (error) {
      this.logger.error(`Failed to query indexing status API`)
      throw error
    }
  }

  async create(name: string): Promise<void> {
    try {
      this.logger.info(`Create subgraph name`, { name })
      const response = await this.rpc.request('subgraph_create', { name })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully created subgraph name`, { name })
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.debug(`Subgraph name already exists`, { name })
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
      const response = await this.rpc.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully deployed subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
    } catch (e) {
      this.logger.error(`Failed to deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
      })
      throw e
    }
  }

  async remove(deployment: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Remove subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.rpc.request('subgraph_reassign', {
        node_id: 'removed',
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Successfully removed subgraph deployment`, {
        deployment: deployment.display,
      })
    } catch (e) {
      this.logger.error(`Failed to remove subgraph deployment`, {
        deployment: deployment.display,
      })
      throw e
    }
  }

  async reassign(
    deployment: SubgraphDeploymentID,
    node: string,
  ): Promise<void> {
    try {
      this.logger.info(`Reassign subgraph deployment`, {
        deployment: deployment.display,
        node,
      })
      const response = await this.rpc.request('subgraph_reassign', {
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
      this.logger.error(`Failed to reassign subgraph deployment`, {
        deployment: deployment.display,
      })
      throw error
    }
  }

  async ensure(name: string, deployment: SubgraphDeploymentID): Promise<void> {
    try {
      await this.create(name)
      await this.deploy(name, deployment)
      await this.reassign(deployment, 'default')
    } catch (error) {
      this.logger.error(`Failed to ensure subgraph deployment is indexing`, {
        name,
        deployment: deployment.display,
        error,
      })
    }
  }
}
