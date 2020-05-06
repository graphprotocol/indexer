import ApolloClient from 'apollo-client'
import { HttpLink } from 'apollo-link-http'
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory'
import gql from 'graphql-tag'
import { logging } from '@graphprotocol/common-ts'

import { SubgraphKey } from './types'

const fetch = require('node-fetch')

export class Indexer {
  statuses: ApolloClient<NormalizedCacheObject>
  logger: logging.Logger

  constructor(url: string, logger: logging.Logger) {
    this.statuses = new ApolloClient({
      link: new HttpLink({
        uri: url,
        fetch,
      }),
      cache: new InMemoryCache(),
    })
    this.logger = logger
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
