import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { SignedRCA } from '@graphprotocol/toolshed'

export interface DecodedRcaProposal {
  // From DB row
  id: string
  status: string
  createdAt: Date

  // Decoded from signed_payload (via toolshed)
  signedRca: SignedRCA
  signedPayload: Uint8Array
  payer: string
  serviceProvider: string
  dataService: string
  deadline: bigint
  endsAt: bigint
  maxInitialTokens: bigint
  maxOngoingTokensPerSecond: bigint
  minSecondsPerCollection: bigint
  maxSecondsPerCollection: bigint
  nonce: bigint

  // Decoded from metadata (via toolshed)
  subgraphDeploymentId: SubgraphDeploymentID
  tokensPerSecond: bigint
  tokensPerEntityPerSecond: bigint
}
