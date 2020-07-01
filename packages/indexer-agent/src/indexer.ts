import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import { Client } from 'jayson/promise'
import { logging } from '@graphprotocol/common-ts'

const jayson = require('jayson/promise')
const fetch = require('node-fetch')

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
        fetch,
      }),
      cache: new InMemoryCache(),
    })
    this.logger = logger
    this.rpc = jayson.client.http(adminEndpoint)
  }

  async connect(): Promise<void> {
    try {
      let subgraphs = await this.subgraphs()
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
      let result = await this.statuses.query({
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

  async create(name: string): Promise<any> {
    try {
      this.logger.info(`Create subgraph name '${name}'`)
      let params: SubgraphCreateParams = { name: name }
      let response = await this.rpc.request('subgraph_create', params)
      if (response.error) throw response.error
      this.logger.info(`Created subgraph name '${name}' successfully`)
      return response.result
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.warn(`Subgraph name already exists: ${name}`)
        return
      }
      throw error
    }
  }

  async deploy(name: string, subgraphId: string): Promise<any> {
    try {
      this.logger.info(`Deploy subgraph '${subgraphId}' to '${name}'`)
      let params: SubgraphDeployParams = { name: name, ipfs_hash: subgraphId }
      let response = await this.rpc.request('subgraph_deploy', params)
      if (response.error) throw response.error
      this.logger.info(
        `Deployed subgraph '${subgraphId}' to '${name}' successfully`,
      )
      return response.result
    } catch (e) {
      this.logger.error(
        `Failed to deploy subgraph '${subgraphId}' to '${name}'`,
      )
      throw e
    }
  }

  async remove(subgraphId: string): Promise<any> {
    try {
      this.logger.info(`Remove subgraph '${subgraphId}`)
      let params: SubgraphReassignParams = {
        ipfs_hash: subgraphId,
        node_id: 'removed',
      }
      let response = await this.rpc.request('subgraph_reassign', params)
      this.logger.info(`Subgraph removed, '${subgraphId}'`)
      return response.result
    } catch (e) {
      this.logger.error(`Failed to remove subgraph '${subgraphId}'`)
      throw e
    }
  }

  async reassign(subgraphId: string, node: string): Promise<any> {
    try {
      this.logger.info(`Reassign subgraph '${subgraphId}' to node '${node}'`)
      let params: SubgraphReassignParams = {
        ipfs_hash: subgraphId,
        node_id: node,
      }
      let response = await this.rpc.request('subgraph_reassign', params)
      if (response.error) throw response.error
      return response.result
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

  async ensure(name: string, subgraphId: string): Promise<any> {
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
