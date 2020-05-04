import { logging, metrics } from '@graphprotocol/common-ts'
import { EventEmitter } from 'events'
import { keccak256, hexlify, BigNumber } from 'ethers/utils'
import assert from 'assert'
import {
  PaidQueryProcessor as PaidQueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  PaymentManager,
  ConditionalPayment,
} from './types'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'

export interface PaidQueryProcessorOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  paymentManager: PaymentManager
  graphNode: string
}

interface PendingQuery {
  paymentId: string
  paymentAmount?: BigNumber
  subgraphId?: string
  requestCid?: string
  query?: string
  paid: boolean

  // Helper to create a promise that resolves when the query is ready,
  // and decouples creating the response from resolving it
  emitter: EventEmitter
}

// TODO: What to do with payments for which we never receive a query?
// - Add a last updated time and periodically clean up stale pending queries?
//
// TODO: What to do with queries for which we never receive a payment?
// - Add a last updated time and periodically clean up stale pending queries?
export class PaidQueryProcessor implements PaidQueryProcessorInterface {
  logger: logging.Logger
  metrics: metrics.Metrics
  paymentManager: PaymentManager
  graphNode: AxiosInstance
  queries: { [key: string]: PendingQuery }

  constructor({ logger, metrics, paymentManager, graphNode }: PaidQueryProcessorOptions) {
    this.logger = logger
    this.metrics = metrics
    this.paymentManager = paymentManager
    this.graphNode = axios.create({
      baseURL: graphNode,

      headers: { 'content-type': 'application/json' },

      // Prevent responses to be deserialized into JSON
      responseType: 'text',

      // Don't transform the response in any way
      transformResponse: (data: any) => data,

      // Don't throw on bad responses
      validateStatus: () => true,
    })
    this.queries = {}
  }

  async addPaidQuery(query: PaidQuery): Promise<PaidQueryResponse> {
    let { subgraphId, paymentId, query: queryString } = query

    let utf8Query = new TextEncoder().encode(queryString)
    let requestCid = keccak256(utf8Query)

    if (this.queries[paymentId] === undefined) {
      // Lazily queue the query
      this.queries[paymentId] = {
        subgraphId,
        paymentId,
        requestCid,
        query: queryString,
        paid: false,
        emitter: new EventEmitter(),
      }
    } else {
      // Update the existing query
      this.queries[paymentId].query = queryString
      this.queries[paymentId].requestCid = requestCid
    }

    return await this.processQueryIfReady(paymentId)
  }

  async addPayment(payment: ConditionalPayment): Promise<void> {
    if (this.queries[payment.paymentId] === undefined) {
      // Lazily queue the payment
      this.queries[payment.paymentId] = {
        paymentId: payment.paymentId,
        paymentAmount: payment.amount,
        paid: true,
        emitter: new EventEmitter(),
      }
    } else {
      // Update the existing query
      this.queries[payment.paymentId].paid = true
      this.queries[payment.paymentId].paymentAmount = payment.amount
    }

    await this.processQueryIfReady(payment.paymentId)
  }

  private async processQueryIfReady(paymentId: string): Promise<PaidQueryResponse> {
    let query = this.queries[paymentId]

    // The query is ready when both the query and the payment were received
    if (query.paid && query.query !== undefined) {
      const processNow = async () => {
        assert.ok(query.subgraphId)
        assert.ok(query.requestCid)
        assert.ok(query.query)
        assert.ok(query.paymentAmount)

        this.logger.debug(`Process query ${query.query} (payment ID: ${query.paymentId})`)

        // Remove query from the queue
        delete this.queries[paymentId]

        // Execute query in the Graph Node
        let response = await this.graphNode.post(
          `/subgraphs/id/${query.subgraphId}`,
          query.query,
        )

        // Compute the response CID
        let responseCid = keccak256(new TextEncoder().encode(response.data))

        // TODO: Compute and sign the attestation (maybe with the
        // help of the payment manager)
        let attestation = hexlify(randomBytes(32))

        // Send the result to the client...
        query.emitter.emit('resolve', {
          status: 200,
          result: {
            requestCid: query.requestCid,
            responseCid,
            attestation: attestation,
            graphQLResponse: response.data,
          },
        })

        // ...and unlock the payment
        await this.paymentManager.unlockPayment({
          paymentId,
          amount: query.paymentAmount!,
          attestation,
        })
      }

      // Don't await the result of the future; the even emitter
      // will take care of resolving the future created below
      processNow()
    }

    return new Promise((resolve, reject) => {
      query.emitter.on('resolve', resolve)
      query.emitter.on('reject', reject)
    })
  }
}
