import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { DocumentNode, print } from 'graphql'
import { CombinedError } from '@urql/core'
import { QueryResult } from './network-subgraph'

export class EpochSubgraph {
  private constructor(private endpointClient: AxiosInstance) {}

  public static async create(endpoint: string): Promise<EpochSubgraph> {
    const endpointClient = axios.create({
      baseURL: endpoint,
      headers: { 'content-type': 'application/json' },

      // Don't parse responses as JSON
      responseType: 'text',

      // Don't transform responses
      transformResponse: (data) => data,
    })
    // Create the Epoch subgraph instance
    return new EpochSubgraph(endpointClient)
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
    if (data.errors) {
      return { error: new CombinedError({ graphQLErrors: data.errors }) }
    }
    return data
  }

  async queryRaw(body: string): Promise<AxiosResponse> {
    return await this.endpointClient.post('', body)
  }
}
