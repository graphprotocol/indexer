import {
  Logger,
  Metrics,
  createAttestation,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { utils, Wallet } from 'ethers'
import axios, { AxiosInstance } from 'axios'

import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  PaymentManager,
  FreeQuery,
  FreeQueryResponse,
} from './types'

export interface PaidQueryProcessorOptions {
  logger: Logger
  metrics: Metrics
  paymentManager: PaymentManager
  graphNode: string
  chainId: number
  disputeManagerAddress: string
}

export class QueryProcessor implements QueryProcessorInterface {
  logger: Logger
  metrics: Metrics
  paymentManager: PaymentManager
  graphNode: AxiosInstance
  chainId: number
  disputeManagerAddress: string

  constructor({
    logger,
    metrics,
    paymentManager,
    graphNode,
    chainId,
    disputeManagerAddress,
  }: PaidQueryProcessorOptions) {
    this.logger = logger
    this.metrics = metrics
    this.paymentManager = paymentManager
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
  }

  async executeFreeQuery(query: FreeQuery): Promise<FreeQueryResponse> {
    const { subgraphDeploymentID, requestCID } = query

    // Execute query in the Graph Node
    const response = await this.graphNode.post(
      `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
      query.query,
    )

    // Compute the response CID
    const responseCID = utils.keccak256(new TextEncoder().encode(response.data))

    const attestation = {
      requestCID,
      responseCID,
      subgraphDeploymentID: subgraphDeploymentID.bytes32,
    }

    return {
      status: 200,
      result: {
        attestation,
        graphQLResponse: response.data,
      },
    }
  }

  private async createResponse({
    signerWallet,
    subgraphDeploymentID,
    requestCID,
    responseCID,
    data,
  }: {
    signerWallet: Wallet
    subgraphDeploymentID: SubgraphDeploymentID
    requestCID: string
    responseCID: string
    data: string
  }): Promise<PaidQueryResponse> {
    // Obtain a signed attestation for the query result
    const receipt = {
      requestCID,
      responseCID,
      subgraphDeploymentID: subgraphDeploymentID.bytes32,
    }
    const attestation = await createAttestation(
      signerWallet.privateKey,
      this.chainId,
      this.disputeManagerAddress,
      receipt,
    )

    return {
      status: 200,
      result: {
        graphQLResponse: data,
        attestation,
      },
    }
  }

  async executePaidQuery(query: PaidQuery): Promise<PaidQueryResponse> {
    const { subgraphDeploymentID, paymentAppState, requestCID } = query

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      paymentAppState,
    })

    const signerWallet = await this.paymentManager.lockPayment(paymentAppState)

    try {
      // Execute query in the Graph Node
      const response = await this.graphNode.post(
        `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
        query.query,
      )

      // Compute the response CID
      const responseCID = utils.keccak256(new TextEncoder().encode(response.data))

      // Create a response that includes a signed attestation
      const attestedResponse = await this.createResponse({
        signerWallet,
        subgraphDeploymentID,
        requestCID,
        responseCID,
        data: response.data,
      })

      // This returns a promise, but there is no need to await it here
      // because the response has no data dependency on the payment state.
      this.paymentManager.savePayment(
        paymentAppState,
        attestedResponse.result.attestation,
      )
      return attestedResponse
    } catch (error) {
      this.logger.debug(`Dropping payment`, {
        paymentAppState,
      })

      // This returns a promise, but there is no need to await it here
      // because the response has no data dependency on the payment state.
      this.paymentManager.dropPayment(paymentAppState)

      throw error
    }
  }
}
