import { utils } from 'ethers'
import axios, { AxiosInstance, AxiosResponse } from 'axios'

import {
  Logger,
  Metrics,
  createAttestation,
  Receipt,
  Eventual,
} from '@graphprotocol/common-ts'
import { ReceiptManager } from '@graphprotocol/receipt-manager'
import {
  QueryProcessor as QueryProcessorInterface,
  PaidQuery,
  PaidQueryResponse,
  UnpaidQueryResponse,
  FreeQuery,
} from './types'
import { AttestationSignerMap } from './allocations'

export interface PaidQueryProcessorOptions {
  logger: Logger
  metrics: Metrics
  receiptManager: ReceiptManager
  graphNode: string
  chainId: number
  disputeManagerAddress: string
  signers: Eventual<AttestationSignerMap>
}

export class QueryProcessor implements QueryProcessorInterface {
  logger: Logger
  metrics: Metrics
  receiptManager: ReceiptManager
  graphNode: AxiosInstance
  chainId: number
  disputeManagerAddress: string
  signers: Eventual<AttestationSignerMap>

  constructor({
    logger,
    metrics,
    receiptManager,
    graphNode,
    chainId,
    disputeManagerAddress,
    signers,
  }: PaidQueryProcessorOptions) {
    this.logger = logger
    this.metrics = metrics
    this.receiptManager = receiptManager
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
    const { subgraphDeploymentID, allocationID, requestCID, stateChannelMessage } = query

    this.logger.info(`Execute paid query`, {
      deployment: subgraphDeploymentID.display,
      allocationID: allocationID,
    })

    // Look up or derive a signer for the attestation for this query
    const signer = (await this.signers.value()).get(allocationID)

    // Fail query outright if we have no signer for this attestation
    if (signer === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = Error(`Unable to sign the query response attestation`) as any
      error.envelopedResponse = JSON.stringify(
        await this.receiptManager.declineQuery(stateChannelMessage),
      )
      error.status = 500
      throw error
    }

    // FIXME: Checking the validity of the state channel message before executing
    // the query is desirable, so it would be good to have a replacement for the
    // commented out code below (which apparently is causing issues).
    //
    // /**
    //  * This call is only needed if the indexer service wants to validate that the stateChannelMessage
    //  *  contains a valid payment before executing the query.
    //  * It is safe to call provideAttestation or declineQuery without first calling inputStateChannelMessage.
    //  * The downside of removing this call is that the indexer service would execute the query and potentially
    //  *  discover that there is no valid payment state.
    //  */
    // await this.receiptManager.inputStateChannelMessage(stateChannelMessage)

    let response: AxiosResponse<string>
    try {
      response = await this.graphNode.post<string>(
        `/subgraphs/id/${subgraphDeploymentID.ipfsHash}`,
        query.query,
      )
    } catch (error) {
      error.envelopedResponse = JSON.stringify(
        await this.receiptManager.declineQuery(stateChannelMessage),
      )
      error.status = 500
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
      signer,
      this.chainId,
      this.disputeManagerAddress,
      receipt,
    )

    const scAttestation = {
      responseCID: attestation.responseCID,
      signature: utils.joinSignature(attestation),
    }
    const envelopedAttestation = await this.receiptManager.provideAttestation(
      stateChannelMessage,
      scAttestation,
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
