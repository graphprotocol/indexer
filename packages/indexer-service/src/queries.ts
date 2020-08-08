import {
  Logger,
  Metrics,
  createAttestation,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { utils } from 'ethers'
import axios, { AxiosInstance } from 'axios'

import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  UnpaidQueryResponse,
  PaymentManager,
  FreeQuery,
  QueryError,
  AllocationPaymentClient,
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

  async executeFreeQuery(query: FreeQuery): Promise<UnpaidQueryResponse> {
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
    stateChannel,
    subgraphDeploymentID,
    requestCID,
    responseCID,
    data,
  }: {
    stateChannel: AllocationPaymentClient
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
      stateChannel.wallet.privateKey,
      this.chainId,
      this.disputeManagerAddress,
      receipt,
    )

    const paymentAppState = await stateChannel.unlockPayment(attestation)

    return {
      status: 200,
      result: {
        graphQLResponse: data,
        attestation,
      },
      paymentAppState,
    }
  }

  async executePaidQuery(query: PaidQuery): Promise<PaidQueryResponse> {
    const { subgraphDeploymentID, paymentAppState, requestCID } = query

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      paymentAppState,
    })

    this.logger.debug(`Process query`, {
      deployment: subgraphDeploymentID.display,
      paymentAppState,
    })

    // TODO: (Liam) Verify the channel here, and lock it?.

    // Check if we have a state channel for this subgraph;
    // this is synonymous with us indexing the subgraph
    const stateChannel = this.paymentManager.stateChannel(paymentAppState)
    if (stateChannel === undefined) {
      throw new QueryError(`Unknown subgraph: ${subgraphDeploymentID}`, 404)
    }

    // TODO: (Liam) Add logic to reject the query if it fails?
    // Execute query in the Graph Node
    const response = await this.graphNode.post(
      `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
      query.query,
    )

    // Compute the response CID
    const responseCID = utils.keccak256(new TextEncoder().encode(response.data))

    // Create a response that includes a signed attestation
    return await this.createResponse({
      stateChannel,
      subgraphDeploymentID,
      requestCID,
      responseCID,
      data: response.data,
    })
  }
}
