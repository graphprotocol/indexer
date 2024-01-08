import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { DocumentNode, print } from 'graphql'
import { CombinedError } from '@urql/core'
import { QueryResult } from './network-subgraph'
import { Logger } from '@graphprotocol/common-ts'
import { SubgraphFreshnessChecker } from './subgraphs'
export class EpochSubgraph {
  endpointClient: AxiosInstance
  freshnessChecker: SubgraphFreshnessChecker
  logger: Logger
  endpoint: string

  constructor(
    endpoint: string,
    freshnessChecker: SubgraphFreshnessChecker,
    logger: Logger,
  ) {
    this.endpoint = endpoint
    this.endpointClient = axios.create({
      baseURL: endpoint,
      headers: { 'content-type': 'application/json' },

      // Don't parse responses as JSON
      responseType: 'text',

      // Don't transform responses
      transformResponse: (data) => data,
    })
    this.freshnessChecker = freshnessChecker
    this.logger = logger
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async checkedQuery<Data = any>(
    query: DocumentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>,
  ): Promise<QueryResult<Data>> {
    return this.freshnessChecker.checkedQuery(this, query, variables)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<Data = any>(
    query: DocumentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>,
  ): Promise<QueryResult<Data>> {
    const response = await this.endpointClient.post('', {
      query: print(query),
      variables,
    })
    const data = JSON.parse(response.data)
    this.logger.trace('Epoch Subgraph query', { data })
    if (data.errors) {
      return { error: new CombinedError({ graphQLErrors: data.errors }) }
    }
    return data
  }

  async queryRaw(body: string): Promise<AxiosResponse> {
    return await this.endpointClient.post('', body)
  }
}
