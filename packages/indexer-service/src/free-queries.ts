import { logging, metrics } from '@graphprotocol/common-ts'
import axios, { AxiosInstance } from 'axios'
import {
  FreeQueryProcessor as FreeQueryProcessorInterface,
  FreeQuery,
  FreeQueryResponse,
} from './types'

export interface FreeQueryProcessorOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  graphNode: string
}

export class FreeQueryProcessor implements FreeQueryProcessorInterface {
  logger: logging.Logger
  metrics: metrics.Metrics
  graphNode: AxiosInstance

  constructor({ logger, metrics, graphNode }: FreeQueryProcessorOptions) {
    this.logger = logger
    this.metrics = metrics
    this.graphNode = axios.create({
      baseURL: graphNode,
      headers: { 'content-type': 'application/json' },

      // Don't throw on errors; pass response straight back to the client
      validateStatus: () => true,
    })
  }

  async addFreeQuery(query: FreeQuery): Promise<FreeQueryResponse> {
    let { subgraphId, query: queryString } = query

    let response = await this.graphNode.post(`/subgraphs/id/${subgraphId}`, queryString)

    return {
      subgraphId,
      status: response.status,
      data: response.data,
    }
  }
}
