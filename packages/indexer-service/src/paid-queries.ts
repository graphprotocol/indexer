import { logging, metrics } from '@graphprotocol/common-ts'
import { EventEmitter } from 'events'
import { keccak256, hexlify, BigNumber } from 'ethers/utils'
import assert from 'assert'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'
import { delay } from '@connext/utils'
import PQueue from 'p-queue'

import {
  PaidQueryProcessor as PaidQueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  PaymentManager,
  ConditionalPayment,
} from './types'

export interface PaidQueryProcessorOptions {
  logger: logging.Logger
  metrics: metrics.Metrics
  paymentManager: PaymentManager
  graphNode: string
}

interface PendingQuery {
  // Incoming payments and queries both carry the payment ID
  paymentId: string

  // A pending query is ready for being processed when both the query
  // and the payment for it have been received
  query?: PaidQuery
  payment?: ConditionalPayment

  // Information about updates and staleness
  updatedAt: number

  // Helper to create a promise that resolves when the query is ready,
  // and decouples creating the response from resolving it
  emitter: EventEmitter
}

export class PaidQueryProcessor implements PaidQueryProcessorInterface {
  logger: logging.Logger
  metrics: metrics.Metrics
  paymentManager: PaymentManager
  graphNode: AxiosInstance

  // Pending queries are kept in a map that maps payment IDs to pending queries.
  queries: Map<string, PendingQuery>

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

    // Start with no pending queries
    this.queries = new Map()

    // Clean up stale queries (i.e. queries where only one of query and
    // payment were received after some time) periodically
    this.periodicallyCleanupStaleQueries()
  }

  async addPaidQuery(query: PaidQuery): Promise<PaidQueryResponse> {
    let { subgraphId, paymentId, query: queryString } = query

    this.logger.info(`Add query for subgraph '${subgraphId}' (payment ID: ${paymentId})`)

    if (this.queries.has(paymentId)) {
      // Update the existing query
      let existingQuery = this.queries.get(paymentId)!

      // Cancel if the same query has already been submitted
      if (existingQuery.query !== undefined) {
        throw new Error(
          `Duplicate query for subgraph '${subgraphId}' and payment '${paymentId}'`,
        )
      }

      existingQuery.query = query
      existingQuery.updatedAt = Date.now()
    } else {
      // Add the incoming query to the "queue"
      this.queries.set(paymentId, {
        paymentId,
        query,
        updatedAt: Date.now(),
        emitter: new EventEmitter(),
      })
    }

    return await this.processQueryIfReady(paymentId)
  }

  async addPayment(payment: ConditionalPayment): Promise<void> {
    let { paymentId, sender, amount } = payment

    this.logger.info(`Add payment '${paymentId}' (sender: ${sender}, amount: ${amount})`)

    if (this.queries.has(paymentId)) {
      // Update the existing query
      let existingQuery = this.queries.get(paymentId)!
      existingQuery.payment = payment
      existingQuery.updatedAt = Date.now()
    } else {
      // Add a pending query for the incoming payment
      this.queries.set(paymentId, {
        paymentId,
        payment,
        updatedAt: Date.now(),
        emitter: new EventEmitter(),
      })
    }

    await this.processQueryIfReady(paymentId)
  }

  private async processQueryIfReady(paymentId: string): Promise<PaidQueryResponse> {
    let query = this.queries.get(paymentId)!

    // The query is ready when both the query and the payment were received
    if (query.payment !== undefined && query.query !== undefined) {
      const processNow = async () => {
        let { subgraphId } = query.query!

        this.logger.debug(
          `Process query for subgraph '${subgraphId}' and payment '${paymentId}'`,
        )

        // Remove query from the "queue"
        this.queries.delete(paymentId)

        // Execute query in the Graph Node
        let response = await this.graphNode.post(
          `/subgraphs/id/${subgraphId}`,
          query.query!.query,
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
            requestCid: query.query!.requestCid,
            responseCid,
            attestation: attestation,
            graphQLResponse: response.data,
          },
        })

        // ...and unlock the payment
        await this.paymentManager.unlockPayment(query.payment!, attestation)
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

  periodicallyCleanupStaleQueries() {
    let _ = (async () => {
      while (true) {
        // Delete stale queries with a concurrency of 10
        let cleanupQueue = new PQueue({ concurrency: 10 })

        let now = Date.now()

        // Add stale queries to the queue
        // Check if the query is stale (no update in >30s)
        for (let query of this.queries.values())
          if (now - query.updatedAt > 30000) {
            // Remove the query from the queue immediately
            this.queries.delete(query.paymentId)

            // Figure out the reason for the timeout
            if (query.payment !== undefined) {
              // Let listeners know that no query was received
              query.emitter.emit(
                'reject',
                new Error(`Payment '${query.paymentId}' timed out waiting for query`),
              )

              // Asynchronously cancel the conditional payment
              cleanupQueue.add(async () => {
                await this.paymentManager.cancelPayment(query.payment!)
              })
            } else {
              // Let listeners know that no payment was received
              query.emitter.emit(
                'reject',
                new Error(
                  `Query for subgraph '${
                    query.query!.subgraphId
                  }' timed out waiting for payment '${query.paymentId}'`,
                ),
              )
            }
          }

        // Wait for 10s
        await delay(10000)
      }
    })()
  }
}
