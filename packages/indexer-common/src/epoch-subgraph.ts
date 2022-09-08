import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { Logger } from '@graphprotocol/common-ts'
import { DocumentNode, print } from 'graphql'
import { CombinedError } from '@urql/core'
import { QueryResult } from './network-subgraph'
export interface EpochSubgraphCreateOptions {
  logger: Logger
  endpoint: string
  network: string
}

interface EpochSubgraphOptions {
  logger: Logger
  endpoint: string
  network: string
}

export class EpochSubgraph {
  logger: Logger
  endpointClient: AxiosInstance
  network: string

  private constructor(options: EpochSubgraphOptions) {
    this.logger = options.logger

    this.endpointClient = axios.create({
      baseURL: options.endpoint,
      headers: { 'content-type': 'application/json' },

      // Don't parse responses as JSON
      responseType: 'text',

      // Don't transform responses
      transformResponse: (data) => data,
    })

    this.network = options.network
  }

  public static async create({
    logger: parentLogger,
    endpoint,
    network,
  }: EpochSubgraphCreateOptions): Promise<EpochSubgraph> {
    const logger = parentLogger.child({
      component: 'EpochSubgraph',
      endpoint,
    })

    // Create the Epoch subgraph instance
    const epochSubgraph = new EpochSubgraph({
      logger,
      endpoint,
      network,
    })
    // Any checks to be made after creating?

    return epochSubgraph
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
