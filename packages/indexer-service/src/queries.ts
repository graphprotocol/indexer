import { utils } from 'ethers'
import axios, { AxiosInstance, AxiosResponse } from 'axios'

import { Logger, Metrics, createAttestation, Eventual } from '@graphprotocol/common-ts'
import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  QueryResult,
  UnattestedQueryResult,
  Response,
  FreeQuery,
} from './types'
import { AttestationSignerMap } from './allocations'
import { ReceiptManager } from './payments'

export interface PaidQueryProcessorOptions {
  logger: Logger
  metrics: Metrics
  graphNode: string
  chainId: number
  disputeManagerAddress: string
  signers: Eventual<AttestationSignerMap>
  receiptManager: ReceiptManager
}

export class QueryProcessor implements QueryProcessorInterface {
  logger: Logger
  metrics: Metrics
  graphNode: AxiosInstance
  chainId: number
  disputeManagerAddress: string
  signers: Eventual<AttestationSignerMap>
  receiptManager: ReceiptManager

  constructor({
    logger,
    metrics,
    graphNode,
    chainId,
    receiptManager,
    disputeManagerAddress,
    signers,
  }: PaidQueryProcessorOptions) {
    this.logger = logger
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
    this.chainId = chainId
    this.disputeManagerAddress = disputeManagerAddress
    this.receiptManager = receiptManager
  }

  async executeFreeQuery(query: FreeQuery): Promise<Response<UnattestedQueryResult>> {
    const { subgraphDeploymentID } = query

    // Execute query in the Graph Node
    const response = await this.graphNode.post(
      `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
      query.query,
    )

    return {
      status: 200,
      result: {
        graphQLResponse: response.data,
      },
    }
  }

  async executePaidQuery(query: PaidQuery): Promise<Response<QueryResult>> {
    const { subgraphDeploymentID, requestCID, payment } = query

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      receipt: query.payment,
      requestCID,
    })

    const allocationID = await this.receiptManager.add(payment)

    // Look up or derive a signer for the attestation for this query
    const signer = (await this.signers.value()).get(allocationID)

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
        query.query,
      )
    } catch (error) {
      error.status = 500
      throw error
    }

    // Compute the response CID
    const responseCID = utils.keccak256(new TextEncoder().encode(response.data))

    // Obtain a signed attestation for the query result
    const attestable = {
      requestCID,
      responseCID,
      subgraphDeploymentID: subgraphDeploymentID.bytes32,
    }

    const attestation = await createAttestation(
      signer,
      this.chainId,
      this.disputeManagerAddress,
      attestable,
    )

    return {
      status: 200,
      result: {
        graphQLResponse: response.data,
        attestation,
      },
    }
  }
}
