import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import jayson, { Client } from 'jayson/promise'
import { logging } from '@graphprotocol/common-ts'
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
  logger: logging.Logger

  constructor(
    adminEndpoint: string,
    statusEndpoint: string,
    logger: logging.Logger,
  ) {
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
      const subgraphs = await this.subgraphs()
      this.logger.info(
        `Connected to indexing statuses API, ${subgraphs.length} subgraphs deployed`,
      )
    } catch (e) {
      this.logger.error(`Failed to connect to indexing statuses API`)
      throw e
    }
  }

  async subgraphs(): Promise<string[]> {
    try {
      const result = await this.statuses.query({
        query: gql`
          query {
            indexingStatuses {
              subgraph
              node
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return result.data.indexingStatuses
        .filter((status: { subgraph: string; node: string }) => {
          return status.node !== 'removed'
        })
        .map((status: { subgraph: string; node: string }) => {
          return status.subgraph
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
        this.logger.warn(`Subgraph name already exists: ${name}`)
        return
      }
      throw error
    }
  }

  async deploy(name: string, subgraphId: string): Promise<void> {
    try {
      this.logger.info(`Deploy subgraph '${subgraphId}' to '${name}'`)
      const params: SubgraphDeployParams = { name: name, ipfs_hash: subgraphId }
      const response = await this.rpc.request('subgraph_deploy', params)
      if (response.error) {
        throw response.error
      }
      this.logger.info(
        `Deployed subgraph '${subgraphId}' to '${name}' successfully`,
      )
    } catch (e) {
      this.logger.error(
        `Failed to deploy subgraph '${subgraphId}' to '${name}'`,
      )
      throw e
    }
  }

  async remove(subgraphId: string): Promise<void> {
    try {
      this.logger.info(`Remove subgraph '${subgraphId}`)
      const params: SubgraphReassignParams = {
        ipfs_hash: subgraphId,
        node_id: 'removed',
      }
      const response = await this.rpc.request('subgraph_reassign', params)
      if (response.error) {
        throw response.error
      }
      this.logger.info(`Subgraph removed, '${subgraphId}'`)
    } catch (e) {
      this.logger.error(`Failed to remove subgraph '${subgraphId}'`)
      throw e
    }
  }

  async reassign(subgraphId: string, node: string): Promise<void> {
    try {
      this.logger.info(`Reassign subgraph '${subgraphId}' to node '${node}'`)
      const params: SubgraphReassignParams = {
        ipfs_hash: subgraphId,
        node_id: node,
      }
      const response = await this.rpc.request('subgraph_reassign', params)
      if (response.error) {
        throw response.error
      }
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.warn(
          `Subgraph deployment assignment unchanged, subgraph: '${subgraphId}', node_id: '${node}'`,
        )
        return
      }
      this.logger.error(`Failed to reassign subgraph, ${subgraphId}`)
      throw error
    }
  }

  async ensure(name: string, subgraphId: string): Promise<void> {
    try {
      await this.create(name)
      await this.deploy(name, subgraphId)
      await this.reassign(subgraphId, 'default')
    } catch (e) {
      this.logger.error(
        `Failed to ensure '${name}':'${subgraphId}' is indexing`,
      )
      throw e
    }
  }
}
