import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from 'axios'

import { Logger, Metrics, Eventual } from '@graphprotocol/common-ts'
import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  QueryResult,
  UnattestedQueryResult,
  Response,
  FreeQuery,
} from './types'
import { AttestationSignerMap } from './allocations'
import { ReceiptManager } from './query-fees'

export interface PaidQueryProcessorOptions {
  logger: Logger
  metrics: Metrics
  graphNode: string
  signers: Eventual<AttestationSignerMap>
  receiptManager: ReceiptManager
  queryTimingLogs: boolean
}

interface AxiosRequestConfigWithTime extends AxiosRequestConfig {
  meta?: { requestStartedAt?: number }
}

interface AxiosResponseWithTime extends AxiosResponse {
  responseTime?: number
  config: AxiosRequestConfigWithTime
}

export class QueryProcessor implements QueryProcessorInterface {
  logger: Logger
  metrics: Metrics
  graphNode: AxiosInstance
  signers: Eventual<AttestationSignerMap>
  receiptManager: ReceiptManager
  queryTimingLogs: boolean

  constructor({
    logger,
    metrics,
    graphNode,
    receiptManager,
    signers,
    queryTimingLogs,
  }: PaidQueryProcessorOptions) {
    this.logger = logger
    this.queryTimingLogs = queryTimingLogs
    this.metrics = metrics
    this.signers = signers
    this.graphNode = axios.create({
      baseURL: graphNode,

      headers: { 'content-type': 'application/json' },

      // Prevent responses to be deserialized into JSON
      responseType: 'text',

      // Don't transform the response in any way
      transformResponse: data => data,

      // Don't throw on bad responses
      validateStatus: () => true,
    })

    if (this.queryTimingLogs) {
      // Set up Axios for request response time measurement
      // https://sabljakovich.medium.com/axios-response-time-capture-and-log-8ff54a02275d
      this.graphNode.interceptors.request.use(function (x: AxiosRequestConfigWithTime) {
        // to avoid overwriting if another interceptor
        // already defined the same object (meta)
        x.meta = x.meta || {}
        x.meta.requestStartedAt = new Date().getTime()
        return x
      })
      this.graphNode.interceptors.response.use(
        function (x: AxiosResponseWithTime) {
          if (x.config.meta?.requestStartedAt !== undefined) {
            x.responseTime = new Date().getTime() - x.config.meta?.requestStartedAt
          }
          return x
        },
        // Handle 4xx & 5xx responses
        function (x: AxiosResponseWithTime) {
          if (x.config.meta?.requestStartedAt !== undefined) {
            x.responseTime = new Date().getTime() - x.config.meta.requestStartedAt
          }
          throw x
        },
      )
    }

    this.receiptManager = receiptManager
  }

  validateResponse(query: String, response: AxiosResponse, ipfsHash: String): void {
    // Check response for specific graphql errors
    const throwableErrors = [
      'Failed to decode `block.hash` value:',
      'Store error: database unavailable',
      'Store error: store error: Fulltext search is not yet deterministic',
      'Failed to decode `block.number` value:'
    ]

    // Optimization: Parse only if the message is small enough, presume there are no critical errors otherwise
    if (response.data.length > 500) {
      return
    }

    const responseData = JSON.parse(response.data);
    if (responseData.errors) {
      this.logger.debug('GraphQL errors', {
        deployment: ipfsHash,
        errors: responseData.errors,
        query,
      })
      for (const graphqlError of responseData.errors) {
        const isThrowableError = throwableErrors.some((errorString) =>
            graphqlError.message.startsWith(errorString)
        );
        if (isThrowableError) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const error = Error(graphqlError.message) as any
          error.status = 500;
          throw error;
        }
      }
    }
  }

  async executeFreeQuery(query: FreeQuery): Promise<Response<UnattestedQueryResult>> {
    const { subgraphDeploymentID } = query

    // Execute query in the Graph Node
    const response = await this.graphNode.post(
      `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
      query.query,
    )

    this.validateResponse(query.query, response, subgraphDeploymentID.ipfsHash)

    return {
      status: 200,
      result: {
        graphQLResponse: response.data,
        attestable: response.headers['graph-attestable'] === 'true',
      },
    }
  }

  async executePaidQuery(paidQuery: PaidQuery): Promise<Response<QueryResult>> {
    const { subgraphDeploymentID, receipt, query } = paidQuery

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      receipt,
    })

    const parsedReceipt = await this.receiptManager.add(receipt)

    // Look up or derive a signer for the attestation for this query
    const signer = (await this.signers.value()).get(parsedReceipt.allocation)

    // Fail query outright if we have no signer for this attestation
    if (signer === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = Error(`Unable to sign the query response attestation`) as any
      error.status = 500
      throw error
    }

    let response: AxiosResponse<string>
    try {
      response = await this.graphNode.post<string>(
        `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
        query,
      )
    } catch (error) {
      error.status = 500
      throw error
    }

    this.validateResponse(query, response, subgraphDeploymentID.ipfsHash)

    let attestation = null
    if (response.headers['graph-attestable'] == 'true') {
      attestation = await signer.createAttestation(query, response.data)
    }

    if (this.queryTimingLogs) {
      this.logger.info('Done executing paid query', {
        deployment: subgraphDeploymentID.ipfsHash,
        fees: parsedReceipt.fees.toBigInt().toString(),
        query: query,
        responseTime: (response as AxiosResponseWithTime).responseTime ?? null,
      })
    }

    return {
      status: 200,
      result: {
        graphQLResponse: response.data,
        attestation,
      },
    }
  }
}
