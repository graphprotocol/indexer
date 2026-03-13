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
    const rows = await this.model.findAll({
      where: { status: 'pending' },
    })

    const decoded: DecodedRcaProposal[] = []
    for (const row of rows) {
      try {
        decoded.push(this.decodeRow(row))
      } catch (error) {
        this.logger.warn(`Failed to decode pending RCA proposal ${row.id}, skipping`, {
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

  async markRejected(id: string, reason?: string): Promise<void> {
    await this.model.update({ status: 'rejected' }, { where: { id } })
    if (reason) {
      this.logger.info(`Rejected proposal ${id}: ${reason}`)
    }
  }

  private decodeRow(row: PendingRcaProposal): DecodedRcaProposal {
    const signedPayload = new Uint8Array(row.signed_payload)
    const signedRca = decodeSignedRCA(signedPayload)
    const { rca } = signedRca

    const metadata = decodeAcceptIndexingAgreementMetadata(rca.metadata)
    const terms = decodeIndexingAgreementTermsV1(metadata.terms)

    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,

      signedRca,
      signedPayload,
      payer: rca.payer,
      serviceProvider: rca.serviceProvider,
      dataService: rca.dataService,
      deadline: rca.deadline,
      endsAt: rca.endsAt,
      maxInitialTokens: rca.maxInitialTokens,
      maxOngoingTokensPerSecond: rca.maxOngoingTokensPerSecond,
      minSecondsPerCollection: rca.minSecondsPerCollection,
      maxSecondsPerCollection: rca.maxSecondsPerCollection,
      nonce: rca.nonce,

      subgraphDeploymentId: new SubgraphDeploymentID(metadata.subgraphDeploymentId),
      tokensPerSecond: terms.tokensPerSecond,
      tokensPerEntityPerSecond: terms.tokensPerEntityPerSecond,
    }
  }
}
