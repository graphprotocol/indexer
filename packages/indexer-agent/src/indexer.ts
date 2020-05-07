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

  constructor(indexNode: string, queryNode: string, logger: logging.Logger) {
    this.statuses = new ApolloClient({
      link: new HttpLink({
        uri: queryNode,
        fetch,
      }),
      cache: new InMemoryCache(),
    })
    this.logger = logger
    this.rpc = new RpcClient<IndexerRpc>({ url: indexNode })
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
      .then((response) => {
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
      .catch((err) => {
        this.logger.error(
          `Indexing statuses query failed, ${err}`,
        )
        throw err
      })
  }
}
