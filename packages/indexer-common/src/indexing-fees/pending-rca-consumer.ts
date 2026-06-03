import { ethers } from 'ethers'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  decodeSignedRCA,
  decodeAcceptIndexingAgreementMetadata,
  decodeIndexingAgreementTermsV1,
} from '@graphprotocol/toolshed'
import { PendingRcaProposal } from '../indexer-management/models/pending-rca-proposal'
import { DecodedRcaProposal } from './types'

export class PendingRcaConsumer {
  constructor(
    private logger: Logger,
    private model: typeof PendingRcaProposal,
  ) {}

  async getPendingProposals(): Promise<DecodedRcaProposal[]> {
    return this.getProposalsByStatus('pending')
  }

  // Proposals accepted on-chain but not yet retired. The rule reaper keeps these
  // deployments' rules alive across the window where the agreement is accepted
  // on-chain but the indexing-payments subgraph hasn't indexed it yet.
  async getAcceptedProposals(): Promise<DecodedRcaProposal[]> {
    return this.getProposalsByStatus('accepted')
  }

  private async getProposalsByStatus(status: string): Promise<DecodedRcaProposal[]> {
    const rows = await this.model.findAll({
      where: { status },
    })

    const decoded: DecodedRcaProposal[] = []
    for (const row of rows) {
      try {
        const proposal = await this.decodeRow(row)
        if (proposal === null) {
          // Decoder already marked the row rejected and logged
          continue
        }
        decoded.push(proposal)
      } catch (error) {
        this.logger.warn(`Failed to decode ${status} RCA proposal ${row.id}, skipping`, {
          error,
        })
      }
    }
    return decoded
  }

  async getPendingProposalsForDeployment(
    deploymentBytes32: string,
  ): Promise<DecodedRcaProposal[]> {
    const all = await this.getPendingProposals()
    return all.filter((p) => p.subgraphDeploymentId.bytes32 === deploymentBytes32)
  }

  async markAccepted(id: string): Promise<void> {
    await this.model.update({ status: 'accepted' }, { where: { id } })
  }

  // Retires an accepted row once the indexing-payments subgraph has indexed the
  // agreement and become its source of truth. After this the row no longer keeps
  // the deployment's rule alive; the subgraph does.
  async markCompleted(id: string): Promise<void> {
    await this.model.update({ status: 'completed' }, { where: { id } })
  }

  async markRejected(id: string, reason?: string): Promise<void> {
    await this.model.update({ status: 'rejected' }, { where: { id } })
    if (reason) {
      this.logger.info(`Rejected proposal ${id}: ${reason}`)
    }
  }

  // Returns the decoded proposal, or null if the row was rejected here
  // (non-empty signature — producer regression, marked rejected in the DB
  // before returning).
  //
  // Decode failures from toolshed (malformed payload, bad metadata, etc.)
  // propagate as throws; the caller skip-logs them, leaving the row pending
  // for the next cycle.
  private async decodeRow(row: PendingRcaProposal): Promise<DecodedRcaProposal | null> {
    const signedPayload = new Uint8Array(row.signed_payload)
    const signedRca = decodeSignedRCA(signedPayload)
    const { rca, signature } = signedRca

    if (signature && signature !== '0x') {
      const sigByteLength = Math.max(0, (signature.length - 2) / 2)
      this.logger.error(
        `Pending RCA proposal ${row.id} has non-empty signature (producer regression); rejecting`,
        { id: row.id, signatureLength: sigByteLength },
      )
      try {
        await this.markRejected(row.id, 'non_empty_signature')
      } catch (err) {
        this.logger.error('Failed to mark non-empty-signature proposal as rejected', {
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return null
    }

    const metadata = decodeAcceptIndexingAgreementMetadata(rca.metadata)
    const terms = decodeIndexingAgreementTermsV1(metadata.terms)

    const agreementId = deriveAgreementId(
      rca.payer,
      rca.dataService,
      rca.serviceProvider,
      rca.deadline,
      rca.nonce,
    )

    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,

      agreementId,

      payer: rca.payer,
      serviceProvider: rca.serviceProvider,
      dataService: rca.dataService,
      deadline: rca.deadline,
      endsAt: rca.endsAt,
      maxInitialTokens: rca.maxInitialTokens,
      maxOngoingTokensPerSecond: rca.maxOngoingTokensPerSecond,
      minSecondsPerCollection: rca.minSecondsPerCollection,
      maxSecondsPerCollection: rca.maxSecondsPerCollection,
      conditions: rca.conditions,
      nonce: rca.nonce,
      metadata: rca.metadata,

      subgraphDeploymentId: new SubgraphDeploymentID(metadata.subgraphDeploymentId),
      tokensPerSecond: terms.tokensPerSecond,
      tokensPerEntityPerSecond: terms.tokensPerEntityPerSecond,
    }
  }
}

// Derives the bytes16 on-chain agreement id from the RCA identity fields.
//
// Mirrors the contract: bytes16(keccak256(abi.encode(payer, dataService,
// serviceProvider, deadline, nonce))).
//
// Returned as a lowercase 0x-prefixed 34-char hex string (0x + 32 hex chars).
export function deriveAgreementId(
  payer: string,
  dataService: string,
  serviceProvider: string,
  deadline: bigint,
  nonce: bigint,
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'address', 'uint64', 'uint256'],
    [payer, dataService, serviceProvider, deadline, nonce],
  )
  return ethers.keccak256(encoded).slice(0, 34).toLowerCase()
}
