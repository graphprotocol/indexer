import { SubgraphDeploymentID } from '@graphprotocol/common-ts'

export interface DecodedRcaProposal {
  // From DB row
  id: string
  status: string
  createdAt: Date

  // Locally derived bytes16 on-chain agreement id (0x-prefixed lowercase).
  // Derived from (payer, dataService, serviceProvider, deadline, nonce).
  agreementId: string

  // Decoded from signed_payload (via toolshed). Signature is required to be empty.
  payer: string
  serviceProvider: string
  dataService: string
  deadline: bigint
  endsAt: bigint
  maxInitialTokens: bigint
  maxOngoingTokensPerSecond: bigint
  minSecondsPerCollection: bigint
  maxSecondsPerCollection: bigint
  conditions: bigint
  nonce: bigint
  metadata: string

  // Decoded from metadata (via toolshed)
  subgraphDeploymentId: SubgraphDeploymentID
  tokensPerSecond: bigint
  tokensPerEntityPerSecond: bigint
}
