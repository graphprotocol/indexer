import { Logger, Metrics, createAttestation, Receipt } from '@graphprotocol/common-ts'
import { utils } from 'ethers'
import axios, { AxiosInstance, AxiosResponse } from 'axios'

import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  UnpaidQueryResponse,
  PaymentManager,
  FreeQuery,
  QueryError,
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

    const attestation: Receipt = {
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

  async executePaidQuery(query: PaidQuery): Promise<PaidQueryResponse> {
    const { subgraphDeploymentID, stateChannelMessage, allocationID, requestCID } = query

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      stateChannelMessage,
    })

    this.logger.debug(`Process query`, {
      deployment: subgraphDeploymentID.display,
      stateChannelMessage,
    })

    // Check if we have a state channel for this subgraph;
    // this is synonymous with us indexing the subgraph
    const allocationClient = this.paymentManager.getAllocationPaymentClient(allocationID)

    if (allocationClient === undefined)
      throw new QueryError(`Unknown subgraph: ${subgraphDeploymentID}`, 404)

    // This may throw an error with a signed envelopedResponse (DeclineQuery)
    await allocationClient.validatePayment(query)

    let response: AxiosResponse<string>
    try {
      response = await this.graphNode.post<string>(
        `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
        query.query,
      )
    } catch (error) {
      error.envelopedResponse = await allocationClient.declineQuery(query)
      throw error
    }

    // Compute the response CID
    const responseCID = utils.keccak256(new TextEncoder().encode(response.data))

    // Obtain a signed attestation for the query result
    const receipt = {
      requestCID,
      responseCID,
      subgraphDeploymentID: subgraphDeploymentID.bytes32,
    }

    const attestation = await createAttestation(
      allocationClient.wallet.privateKey,
      this.chainId,
      this.disputeManagerAddress,
      receipt,
    )

    const envelopedAttestation = await allocationClient.provideAttestation(
      query,
      attestation,
    )

    return {
      status: 200,
      result: {
        graphQLResponse: response.data,
        attestation,
      },
      envelopedAttestation: JSON.stringify(envelopedAttestation),
    }
  }
}
