import { ethers } from 'ethers'
import { IndexingVoucher } from './models'

/** ABI repr of the solidity struct IndexingAgreementVoucher */
export interface IndexingAgreementVoucherABI {
  payer: string
  payee: string
  service: string
  maxInitialAmount: bigint
  maxOngoingAmountPerEpoch: bigint
  deadline: number
  maxEpochsPerCollection: number
  minEpochsPerCollection: number
  durationEpochs: number
  metadata: string
}

/** ABI repr of the solidity SubgraphIndexingVoucherMetadata*/
export interface SubgraphIndexingAgreementVoucherMetadataABI {
  subgraphDeploymentId: string
  pricePerBlock: bigint
}

/** Field types and order of ABI-encoded fields for IndexingAgreementVoucher solidity struct */
export const IndexingAgreementVoucherABIFields = [
  'address payer',
  'address payee',
  'address service',
  'uint256 maxInitialAmount',
  'uint256 maxOngoingAmountPerEpoch',
  'uint64 deadline',
  'uint32 maxEpochsPerCollection',
  'uint32 minEpochsPerCollection',
  'uint32 durationEpochs',
  'bytes metadata',
]

/** Field types and order of ABI-encoded fields for SubgraphIndexingVoucherMetadata solidity struct */
export const SubgraphIndexingVoucherMetadataABIFields = [
  'bytes32 subgraphDeploymentId',
  'uint256 pricePerBlock',
]

/** Retrieve the valid signers from the environment */
function getValidSignersFromEnv(): string[] {
  const validSigners = process.env.VALID_SIGNERS
  if (!validSigners) {
    throw new Error('VALID_SIGNERS not set')
  }

  return validSigners.split(',')
}

function verify(signature: string, data: string): boolean {
  const validSigners = getValidSignersFromEnv()
  const recoveredAddress = ethers.utils.verifyMessage(data, signature)
  return validSigners.includes(recoveredAddress)
}

/** Deserialize ABI encoded Indexing agreement voucher from data. */
export function fromSignatureAndData(signature: string, data: string): IndexingVoucher {
  if (!verify(signature, data)) {
    throw new Error('Invalid signature')
  }

  const decoded = ethers.utils.defaultAbiCoder.decode(
    IndexingAgreementVoucherABIFields,
    data,
  )

  const metadata = ethers.utils.defaultAbiCoder.decode(
    SubgraphIndexingVoucherMetadataABIFields,
    decoded.metadata,
  )

  return {
    signature,
    // voucher fields
    payer: decoded.payer,
    payee: decoded.payee,
    service: decoded.service,
    maxInitialAmount: decoded.maxInitialAmount,
    maxOngoingAmountPerEpoch: decoded.maxOngoingAmountPerEpoch,
    deadline: decoded.deadline,
    maxEpochsPerCollection: decoded.maxEpochsPerCollection,
    minEpochsPerCollection: decoded.minEpochsPerCollection,
    // metadata fields
    subgraphDeploymentId: metadata.subgraphDeploymentId,
    pricePerBlock: metadata.pricePerBlock,
  }
}
