import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import { RpcClient } from 'jsonrpc-ts'
import { logging } from '@graphprotocol/common-ts'

import { SubgraphKey } from './types'

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

  async subgraphs(): Promise<SubgraphKey[]> {
    return this.statuses
      .query({
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
      .then(response => {
        return (response.data as any).indexingStatuses
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
              return <SubgraphKey>{ contentHash: status.subgraph }
            },
          )
      })
      .catch(err => {
        this.logger.error(`Indexing statuses query failed, ${err}`)
        throw err
      })
  }

  async create(name: string): Promise<any> {
    let response
    try {
      response = await this.rpc.makeRequest({
        method: 'subgraph_create',
        params: { name: name },
        id: '1',
        jsonrpc: '2.0',
      })
    } catch (error) {
      if (error.message.includes('already exists')) {
        this.logger.warn(
          `Attempted to create a subgraph which already exists: ${name}`,
        )
        return
      }
      throw error
    }
    return response.data.result
  }

  async deploy(name: string, contentHash: string): Promise<any> {
    let response
    try {
      response = await this.rpc.makeRequest({
        method: 'subgraph_deploy',
        params: { name: name, ipfs_hash: contentHash },
        id: '1',
        jsonrpc: '2.0',
      })
    } catch (e) {
      this.logger.error(`Failed to deploy subgraph ${name}:${contentHash}`)
      throw e
    }
    return response.data.result
  }

  async remove(contentHash: string): Promise<any> {
    let response
    try {
      response = await this.rpc.makeRequest({
        method: 'subgraph_reassign',
        params: { ipfs_hash: contentHash, node_id: 'removed' },
        id: '1',
        jsonrpc: '2.0',
      })
    } catch (e) {
      this.logger.error(`Failed to remove subgraph ${name}:${contentHash}`)
      throw e
    }
    this.logger.info(`Subgraph removed, ${contentHash}`)
    return response.data.result
  }

  async reassign(contentHash: string, node: string): Promise<any> {
    let response
    try {
      response = await this.rpc.makeRequest({
        method: 'subgraph_reassign',
        params: { ipfs_hash: contentHash, node_id: node },
        id: '1',
        jsonrpc: '2.0',
      })
    } catch (error) {
      if (error.message.includes('unchanged')) {
        this.logger.warn(
          `Attempted a subgraph reassignment without changes, subgraph: ${contentHash} node_id: ${node}`,
        )
        return
      }
      this.logger.error(`Failed to reassign subgraph, ${contentHash}`)
      throw error
    }
    return response.data.result
  }

  async ensure(name: string, contentHash: string): Promise<any> {
    this.logger.info(`Deploying subgraph ${name}:${contentHash} for indexing`)
    return this.create(name)
      .then(() => this.deploy(name, contentHash))
      .then(() => this.reassign(contentHash, 'default'))
      .catch(e => {
        this.logger.error(
          `Failed to begin indexing ${name}:${contentHash}: ${e}`,
        )
        throw e
      })
  }
}
