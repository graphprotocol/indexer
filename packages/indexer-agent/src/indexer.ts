import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import jayson, { Client } from 'jayson/promise'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import fetch from 'node-fetch'

interface SubgraphCreateParams {
  name: string
}
interface SubgraphDeployParams {
  name: string
  ipfs_hash: string
}
interface SubgraphReassignParams {
  ipfs_hash: string
  node_id: string
}

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
      const subgraphDeployments = await this.subgraphDeployments()
      this.logger.info(
        `Connected to indexing statuses API, ${subgraphDeployments.length} deployments are being indexed`,
      )
    } catch (e) {
      this.logger.error(`Failed to connect to indexing statuses API`)
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
      this.logger.error(`Indexing statuses query failed`)
      throw error
    }
  }

  async create(name: string): Promise<void> {
    try {
      this.logger.info(`Create subgraph name '${name}'`)
      const params: SubgraphCreateParams = { name: name }
      const response = await this.rpc.request('subgraph_create', params)
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Created subgraph name '${name}' successfully`)
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.debug(`Subgraph name already exists: ${name}`)
        return
      }
      throw error
    }
  }

  async deploy(
    name: string,
    subgraphDeploymentID: SubgraphDeploymentID,
  ): Promise<void> {
    try {
      this.logger.info(
        `Deploy subgraph deployment '${subgraphDeploymentID}' to '${name}'`,
      )
      const params: SubgraphDeployParams = {
        name: name,
        ipfs_hash: subgraphDeploymentID.ipfsHash,
      }
      const response = await this.rpc.request('subgraph_deploy', params)
      if (response.error) {
        throw response.error
      }
      this.logger.info(
        `Deployed subgraph deployment '${subgraphDeploymentID}' to '${name}' successfully`,
      )
    } catch (e) {
      this.logger.error(
        `Failed to deploy subgraph '${subgraphDeploymentID}' to '${name}'`,
      )
      throw e
    }
  }

  async remove(subgraphDeploymentID: SubgraphDeploymentID): Promise<void> {
    try {
      this.logger.info(`Remove subgraph deployment '${subgraphDeploymentID}`)
      const params: SubgraphReassignParams = {
        ipfs_hash: subgraphDeploymentID.ipfsHash,
        node_id: 'removed',
      }
      const response = await this.rpc.request('subgraph_reassign', params)
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Subgraph deployment removed, '${subgraphDeploymentID}'`)
    } catch (e) {
      this.logger.error(
        `Failed to remove subgraph deployment '${subgraphDeploymentID}'`,
      )
      throw e
    }
  }

  async reassign(
    subgraphDeploymentID: SubgraphDeploymentID,
    node: string,
  ): Promise<void> {
    try {
      this.logger.info(
        `Reassign subgraph deployment '${subgraphDeploymentID}' to node '${node}'`,
      )
      const params: SubgraphReassignParams = {
        ipfs_hash: subgraphDeploymentID.ipfsHash,
        node_id: node,
      }
      const response = await this.rpc.request('subgraph_reassign', params)
      if (response.error) {
        throw response.error
      }
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.debug(
          `Subgraph deployment assignment unchanged, deployment: '${subgraphDeploymentID}', node_id: '${node}'`,
        )
        return
      }
      this.logger.error(
        `Failed to reassign subgraph deployment '${subgraphDeploymentID}'`,
      )
      throw error
    }
  }

  async ensure(
    name: string,
    subgraphDeploymentID: SubgraphDeploymentID,
  ): Promise<void> {
    try {
      await this.create(name)
      await this.deploy(name, subgraphDeploymentID)
      await this.reassign(subgraphDeploymentID, 'default')
    } catch (e) {
      this.logger.error(
        `Failed to ensure '${name}':'${subgraphDeploymentID}' is indexing: ${e.message}`,
      )
    }
  }
}
