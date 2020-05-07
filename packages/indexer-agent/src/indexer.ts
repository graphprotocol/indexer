import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import { RpcClient } from 'jsonrpc-ts'
import { logging } from '@graphprotocol/common-ts'

const fetch = require('node-fetch')

interface IndexerRpc {
  subgraph_reassign: { name: string; ipfs_hash: string; node_id: string }
  subgraph_deploy: { name: string; ipfs_hash: string }
  subgraph_create: { name: string }
}

export class Indexer {
  statuses: ApolloClient<NormalizedCacheObject>
  rpc: RpcClient
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
    this.rpc = new RpcClient<IndexerRpc>({ url: adminEndpoint })
  }

  async subgraphs(): Promise<string[]> {
    try {
      let result = await this.statuses.query({
        query: gql`
          query {
            indexingStatuses {
              subgraph
              synced
              failed
              node
            }
          }
        `,
        fetchPolicy: 'no-cache',
      })
      return result.data.indexingStatuses
        .filter(
          (status: {
            subgraph: string
            failed: string
            synced: string
            error: string
            node: string
          }) => {
            return status.node !== 'removed'
          },
        )
        .map(
          (status: {
            subgraph: string
            failed: string
            synced: string
            error: string
            node: string
          }) => {
            return status.subgraph
          },
        )
    } catch (error) {
      this.logger.error(`Indexing statuses query failed`)
      throw error
    }
  }

  async create(name: string): Promise<any> {
    try {
      this.logger.info(`Create subgraph name '${name}'`)
      let response = await this.rpc.makeRequest({
        method: 'subgraph_create',
        params: { name: name },
        id: '1',
        jsonrpc: '2.0',
      })
      this.logger.info(`Created subgraph name '${name}' successfully`)
      return response.data.result
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
      let response = await this.rpc.makeRequest({
        method: 'subgraph_deploy',
        params: { name: name, ipfs_hash: subgraphId },
        id: '1',
        jsonrpc: '2.0',
      })
      this.logger.info(
        `Deployed subgraph '${subgraphId}' to '${name}' successfully`,
      )
      return response.data.result
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
      let response = await this.rpc.makeRequest({
        method: 'subgraph_reassign',
        params: { ipfs_hash: subgraphId, node_id: 'removed' },
        id: '1',
        jsonrpc: '2.0',
      })
      this.logger.info(`Subgraph removed, '${subgraphId}'`)
      return response.data.result
    } catch (e) {
      this.logger.error(`Failed to remove subgraph '${subgraphId}'`)
      throw e
    }
  }

  async reassign(subgraphId: string, node: string): Promise<any> {
    try {
      this.logger.info(`Reassign subgraph '${subgraphId}' to node '${node}'`)
      let response = await this.rpc.makeRequest({
        method: 'subgraph_reassign',
        params: { ipfs_hash: subgraphId, node_id: node },
        id: '1',
        jsonrpc: '2.0',
      })
      return response.data.result
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.warn(
          `Subgraph deployment assignment unchange:, subgraph: '${subgraphId}' node_id: '${node}'`,
        )
        return
      }
      this.logger.error(`Failed to reassign subgraph, ${subgraphId}`)
      throw error
    }
  }

  async ensure(name: string, subgraphId: string): Promise<any> {
    this.logger.info(
      `Begin indexing subgraph '${name}' '${subgraphId}'`,
    )
    return this.create(name)
      .then(() => this.deploy(name, subgraphId))
      .then(() => this.reassign(subgraphId, 'default'))
      .catch(e => {
        this.logger.error(`Failed to ensure '${subgraphId}' is actively deployed to the indexer`)
        throw e
      })
  }
}
